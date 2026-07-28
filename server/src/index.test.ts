import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));

function boot(overrides: NodeJS.ProcessEnv) {
  const env = {
    ...process.env,
    NODE_ENV: "development",
    CAPACITYLENS_DB: ":memory:",
    CAPACITYLENS_AUDIT: "off",
    SMALLSASS_ACCOUNT_MODE: "off",
    ...overrides,
  };
  const directory = mkdtempSync(join(tmpdir(), "capacitylens-index-test-"));
  const stdoutPath = join(directory, "stdout.log");
  const stderrPath = join(directory, "stderr.log");
  let stdout = openSync(stdoutPath, "w");
  let stderr = openSync(stderrPath, "w");
  try {
    // tsx may start an esbuild helper. Capture through files so a short-lived descendant cannot
    // keep a stdio pipe open after the entrypoint has already exited with its refusal status.
    const result = spawnSync(
      process.execPath,
      [tsxCli, "src/index.ts"],
      {
        cwd: process.cwd(),
        env,
        stdio: ["ignore", stdout, stderr],
        timeout: 10_000,
      },
    );
    closeSync(stdout);
    stdout = -1;
    closeSync(stderr);
    stderr = -1;
    return {
      ...result,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
    };
  } finally {
    if (stdout !== -1) closeSync(stdout);
    if (stderr !== -1) closeSync(stderr);
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("server entrypoint startup refusals", () => {
  it("frames a buildApp configuration failure without a raw stack", () => {
    const result = boot({
      CAPACITYLENS_CORS_ORIGIN: "*",
      CAPACITYLENS_BACKUP_DIR: "",
    });

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(
      "capacitylens-server: refusing to start — CORS requires explicit origins when cookie authentication is enabled.",
    );
    expect(result.stderr).not.toContain("at buildApp");
  });

  it("frames a configured backup path that is not a directory", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "capacitylens-backup-refusal-test-"),
    );
    const backupDir = join(directory, "not-a-directory");
    writeFileSync(backupDir, "filesystem obstruction");
    try {
      const result = boot({
        CAPACITYLENS_CORS_ORIGIN: "http://localhost:5173",
        CAPACITYLENS_BACKUP_DIR: backupDir,
      });

      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain(
        `capacitylens-server: refusing to start — CAPACITYLENS_BACKUP_DIR=${JSON.stringify(backupDir)} could not be initialized:`,
      );
      expect(result.stderr).not.toContain("at startBackups");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
