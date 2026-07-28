import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function boot(overrides: NodeJS.ProcessEnv) {
  const env = {
    ...process.env,
    NODE_ENV: "development",
    CAPACITYLENS_DB: ":memory:",
    CAPACITYLENS_AUDIT: "off",
    SMALLSASS_ACCOUNT_MODE: "off",
    ...overrides,
  };
  return spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
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

  it("frames an unwritable configured backup directory", () => {
    const backupDir = `/proc/capacitylens-backup-startup-${process.pid}`;
    const result = boot({
      CAPACITYLENS_CORS_ORIGIN: "http://localhost:5173",
      CAPACITYLENS_BACKUP_DIR: backupDir,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `capacitylens-server: refusing to start — CAPACITYLENS_BACKUP_DIR=${JSON.stringify(backupDir)} could not be initialized:`,
    );
    expect(result.stderr).not.toContain("at startBackups");
  });
});
