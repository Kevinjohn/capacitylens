import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configSource = await readFile(new URL("../playwright.config.ts", import.meta.url), "utf8");

test("every automatically started Playwright server refuses an existing endpoint", () => {
  const reuseSettings = [...configSource.matchAll(/reuseExistingServer:\s*([^,\n]+)/g)].map((match) => match[1].trim());

  assert.equal(reuseSettings.length, 7, "expected every configured dev server to declare its reuse policy");
  assert.deepEqual(
    reuseSettings,
    Array.from({ length: 7 }, () => "false"),
  );
});
