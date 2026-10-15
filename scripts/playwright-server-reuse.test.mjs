import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configSource = await readFile(new URL("../playwright.config.ts", import.meta.url), "utf8");
const viteConfigSource = await readFile(new URL("../apps/frontend/vite.config.ts", import.meta.url), "utf8");

test("every automatically started Playwright server refuses an existing endpoint", () => {
  const reuseSettings = [...configSource.matchAll(/reuseExistingServer:\s*([^,\n]+)/g)].map((match) => match[1].trim());

  assert.equal(reuseSettings.length, 5, "expected every configured dev server to declare its reuse policy");
  assert.deepEqual(
    reuseSettings,
    Array.from({ length: 5 }, () => "false"),
  );
});

test("the standard profile waits for real database readiness through both Vite proxies", () => {
  const probes = [
    ...configSource.matchAll(
      /url:\s*`http:\/\/127\.0\.0\.1:\$\{(API_PORT|DB_WEB_PORT|AUTH_API_PORT|AUTH_WEB_PORT)\}([^`]*)`/g,
    ),
  ].map((match) => `${match[1]}${match[2]}`);

  assert.deepEqual(probes, [
    "API_PORT/health/ready",
    "DB_WEB_PORT/health/ready",
    "AUTH_API_PORT/health/ready",
    "AUTH_WEB_PORT/health/ready",
  ]);
  assert.match(viteConfigSource, /"\/health":\s*{[\s\S]*?target: `http:\/\/localhost:\$\{devApiPort\}`/);
});
