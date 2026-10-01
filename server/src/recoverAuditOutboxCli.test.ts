import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openDb } from "./db";

const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
const script = fileURLToPath(new URL("../scripts/recover-audit-outbox.ts", import.meta.url));

it("accepts the documented pnpm argument separator when inspecting a current database", () => {
  const directory = mkdtempSync(join(tmpdir(), "capacitylens-audit-cli-"));
  try {
    const databasePath = join(directory, "capacitylens.db");
    openDb(databasePath).close();
    const result = spawnSync(process.execPath, [tsxCli, script, "--", "inspect", databasePath], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: "empty" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
