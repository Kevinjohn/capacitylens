import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const fixture = fileURLToPath(
  new URL("./fixtures/databases/v12-password.db", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("migration rehearsal", () => {
  it("fails closed when a known table gains an unclassified column", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "capacitylens-rehearsal-columns-test-"),
    );
    temporaryDirectories.push(directory);
    const source = join(directory, "v12-with-future-column.db");
    copyFileSync(fixture, source);
    const prepared = new DatabaseSync(source);
    prepared.exec(`ALTER TABLE account ADD COLUMN futureSecret TEXT`);
    prepared.close();

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/rehearse-migrations.ts",
        "--source",
        source,
        "--keep",
      ],
      {
        cwd: serverDirectory,
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, INIT_CWD: serverDirectory, TMPDIR: directory },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "anonymiser does not cover column(s): account.futureSecret",
    );
  });

  it("preserves anonymised user linkage and observes the v14 verification revocation", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "capacitylens-rehearsal-test-"),
    );
    temporaryDirectories.push(directory);
    const source = join(directory, "v12-with-reset.db");
    copyFileSync(fixture, source);

    const prepared = new DatabaseSync(source);
    const member = prepared
      .prepare(
        `SELECT userId FROM account_members WHERE status = 'active' ORDER BY userId LIMIT 1`,
      )
      .get() as { userId: string };
    const insertCeremony = prepared.prepare(`
      INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertCeremony.run(
      "synthetic-reset",
      "synthetic-reset-identifier",
      member.userId,
      "2026-08-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
    insertCeremony.run(
      "synthetic-unlinked",
      "synthetic-unlinked-identifier",
      "source-only-ceremony-value",
      "2026-08-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
    prepared.close();

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/rehearse-migrations.ts",
        "--source",
        source,
        "--keep",
      ],
      {
        cwd: serverDirectory,
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, INIT_CWD: serverDirectory, TMPDIR: directory },
      },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const retained = /Anonymised rehearsal artifacts retained at (.+)/
      .exec(result.stdout)?.[1]
      ?.trim();
    expect(retained).toBeTruthy();

    const anonymised = new DatabaseSync(
      join(retained!, "anonymised-source.db"),
      { readOnly: true },
    );
    expect(
      (
        anonymised
          .prepare(
            `
      SELECT COUNT(*) AS n
        FROM verification AS ceremony
        JOIN user AS principal ON principal.id = ceremony.value
    `,
          )
          .get() as { n: number }
      ).n,
    ).toBe(1);
    expect(
      (
        anonymised
          .prepare(
            `
      SELECT ceremony.value
        FROM verification AS ceremony
        JOIN user AS principal ON principal.id = ceremony.value
    `,
          )
          .get() as { value: string }
      ).value,
    ).toMatch(/^rehearsal-user-/);
    expect(
      anonymised.prepare(`SELECT value FROM verification ORDER BY id`).all(),
    ).not.toContainEqual({ value: "source-only-ceremony-value" });
    anonymised.close();

    const migrated = new DatabaseSync(join(retained!, "happy.db"), {
      readOnly: true,
    });
    expect(
      (
        migrated.prepare(`SELECT COUNT(*) AS n FROM verification`).get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(
      (
        migrated.prepare(`SELECT value FROM verification`).get() as {
          value: string;
        }
      ).value,
    ).toMatch(/^rehearsal-dangling-principal-/);
    migrated.close();
  });
});
