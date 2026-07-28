import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("bundle budget entry selection", () => {
  let directory: string | null = null;

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  const arrange = (html: string) => {
    directory = mkdtempSync(join(tmpdir(), "capacitylens-bundle-budget-"));
    mkdirSync(join(directory, "scripts"), { recursive: true });
    mkdirSync(join(directory, "dist/assets"), { recursive: true });
    cpSync(resolve("scripts/check-bundle-budget.mjs"), join(directory, "scripts/check-bundle-budget.mjs"));
    writeFileSync(join(directory, "dist/index.html"), html);
    writeFileSync(join(directory, "dist/assets/app.js"), "export const app = true\n");
    writeFileSync(join(directory, "dist/assets/shim.js"), "export const shim = true\n");
  };

  it("accepts one module entry regardless of attribute order and quote style", () => {
    arrange(`<script src='/assets/app.js' crossorigin type='module'></script>`);
    const result = spawnSync(process.execPath, ["scripts/check-bundle-budget.mjs"], {
      cwd: directory!,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("/assets/app.js");
  });

  it("refuses to guess when two module entries are present", () => {
    arrange(`
      <script type="module" src="/assets/shim.js"></script>
      <script type="module" src="/assets/app.js"></script>
    `);
    const result = spawnSync(process.execPath, ["scripts/check-bundle-budget.mjs"], {
      cwd: directory!,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("expected exactly one JavaScript module entry");
    expect(result.stderr).toContain("found 2");
  });
});
