import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function isIgnored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "--no-index", "--quiet", path], {
      cwd: resolve(process.cwd(), ".."),
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

describe("repository artifact policy", () => {
  it("ignores runtime databases but exposes released compatibility fixtures", () => {
    expect(isIgnored("capacitylens-local.db")).toBe(true);
    expect(isIgnored("server/src/fixtures/databases/v99-off.db")).toBe(false);
    expect(isIgnored("server/src/fixtures/databases/v99-off.db-wal")).toBe(true);
  });
});
