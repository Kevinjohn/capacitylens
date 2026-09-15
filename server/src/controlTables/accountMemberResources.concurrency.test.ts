import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db";
import { upsertMember } from "./members";

const NOW = "2026-09-14T10:00:00.000Z";
const CHILD_SOURCE = `
  import { readSync } from "node:fs";
  import { openDb } from ${JSON.stringify(new URL("../db.ts", import.meta.url).href)};
  import { setAccountMemberResourceLink } from ${JSON.stringify(new URL("./accountMemberResources.ts", import.meta.url).href)};
  const dbPath = process.argv[1];
  const direction = process.argv[2];
  const hold = process.argv[3] === "true";
  if (!dbPath || (direction !== "member" && direction !== "resource")) throw new Error("Invalid race arguments.");
  const db = openDb(dbPath);
  db.function("capacitylens_member_resource_wait", () => {
    if (hold) {
      process.stdout.write("entered\\n");
      const byte = Buffer.alloc(1);
      readSync(0, byte, 0, 1, null);
    }
    return 1;
  });
  if (hold) {
    db.exec(
      "CREATE TRIGGER capacitylens_member_resource_wait BEFORE INSERT ON account_member_resources " +
        "BEGIN SELECT capacitylens_member_resource_wait(); END",
    );
  }
  const userId = hold || direction === "member" ? "u1" : "u2";
  const resourceId = direction === "member" ? (hold ? "r1" : "r2") : "r1";
  if (!hold) {
    process.stdout.write("ready\\n");
    const byte = Buffer.alloc(1);
    readSync(0, byte, 0, 1, null);
  }
  process.stdout.write("attempting\\n");
  try {
    const link = setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId,
      resourceId,
      expectedRevision: null,
      now: "${NOW}",
    });
    process.stdout.write(JSON.stringify({ ok: true, resourceId: link.resourceId }) + "\\n");
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      }) + "\\n",
    );
  } finally {
    db.close();
  }
`;

interface ChildRun {
  child: ChildProcessWithoutNullStreams;
  output: string;
  error: string;
}

function startChild(dbPath: string, direction: "member" | "resource", hold: boolean): ChildRun {
  const child = spawn(process.execPath, ["--import", "tsx", "--eval", CHILD_SOURCE, dbPath, direction, String(hold)], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state = { child, output: "", error: "" };
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (state.output += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (state.error += chunk));
  return state;
}

function waitForOutput(state: ChildRun, marker: string): Promise<void> {
  if (state.output.includes(marker)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onData = () => {
      if (state.output.includes(marker)) {
        state.child.stdout.off("data", onData);
        resolve();
      }
    };
    state.child.stdout.on("data", onData);
    state.child.once("error", reject);
    state.child.once("close", (code) => {
      if (!state.output.includes(marker))
        reject(new Error(`Race child exited before ${marker}: ${code}\n${state.error}`));
    });
  });
}

function closeChild(state: ChildRun): Promise<{ code: number | null; output: string; error: string }> {
  return new Promise((resolve, reject) => {
    state.child.once("error", reject);
    state.child.once("close", (code) => resolve({ code, output: state.output, error: state.error }));
  });
}

function readResult(output: string): { ok: boolean; resourceId?: string; name?: string; message?: string } {
  const line = output.trim().split("\n").at(-1);
  if (!line) throw new Error(`Race child emitted no result: ${output}`);
  return JSON.parse(line) as { ok: boolean; resourceId?: string; name?: string; message?: string };
}

function seedRaceDatabase(dbPath: string): void {
  const db = openDb(dbPath);
  db.prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`).run(
    "a1",
    "Wayne Enterprises",
    "#6366f1",
    NOW,
    NOW,
  );
  for (const id of ["r1", "r2"])
    db.prepare(
      `INSERT INTO resources
         (id, accountId, kind, name, role, color, employmentType, engagement,
          workingHoursPerDay, workingDays, halfDays, createdAt, updatedAt)
         VALUES (?, 'a1', 'person', ?, 'Designer', '#6366f1', 'employee', 'studio', 8,
          '[1,2,3,4,5]', '[]', ?, ?)`,
    ).run(id, id, NOW, NOW);
  upsertMember(db, { accountId: "a1", userId: "u1", role: "owner", status: "active", createdAt: NOW });
  upsertMember(db, { accountId: "a1", userId: "u2", role: "admin", status: "active", createdAt: NOW });
  db.close();
}

async function runRace(direction: "member" | "resource"): Promise<void> {
  const dbPath = join(tmpdir(), `capacitylens-member-resource-race-${process.pid}-${randomUUID()}.db`);
  seedRaceDatabase(dbPath);
  const second = startChild(dbPath, direction, false);
  await waitForOutput(second, "ready\n");
  const first = startChild(dbPath, direction, true);
  try {
    await waitForOutput(first, "entered\n");
    second.child.stdin.write("x");
    await waitForOutput(second, "attempting\n");
    first.child.stdin.write("x");
    first.child.stdin.end();
    const [firstResult, secondResult] = await Promise.all([closeChild(first), closeChild(second)]);
    expect(firstResult.code, firstResult.error).toBe(0);
    expect(secondResult.code, secondResult.error).toBe(0);
    expect(readResult(firstResult.output)).toEqual({ ok: true, resourceId: "r1" });
    const loser = readResult(secondResult.output);
    expect(loser).toMatchObject({ ok: false, name: "AccountMemberResourceConflict" });
    expect(loser.message).toMatch(direction === "member" ? /changed/i : /already linked/i);

    const db = openDb(dbPath);
    const rows = db.prepare(`SELECT userId, resourceId FROM account_member_resources ORDER BY userId`).all();
    db.close();
    expect(rows).toEqual([{ userId: "u1", resourceId: "r1" }]);
  } finally {
    if (first.child.exitCode === null) first.child.kill();
    if (second.child.exitCode === null) second.child.kill();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
  }
}

describe("member/resource association uniqueness under overlapping connections", () => {
  it("serializes competing links for one member", async () => {
    await runRace("member");
  });

  it("serializes competing links for one scheduled person", async () => {
    await runRace("resource");
  });
});
