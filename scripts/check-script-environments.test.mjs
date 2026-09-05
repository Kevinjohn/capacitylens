import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../", import.meta.url)) });
const browserFiles = ["public/auth-error-init.js", "public/theme-init.js", "public/future-script.js"];

test("browser and worker scripts reject Node globals", async () => {
  for (const filePath of [...browserFiles, "public/offline-worker.js"]) {
    const [result] = await eslint.lintText("void process; void Buffer; void require; void __dirname;", { filePath });
    assert.equal(result.fatalErrorCount, 0, filePath);
    assert.deepEqual(
      result.messages.map(({ ruleId }) => ruleId),
      Array(4).fill("no-undef"),
      filePath,
    );
  }
});

test("browser scripts retain DOM globals and workers retain their own environment", async () => {
  for (const filePath of browserFiles) {
    const [result] = await eslint.lintText("void document.documentElement; void window.matchMedia;", { filePath });
    assert.deepEqual(result.messages, [], filePath);
  }
  const filePath = "public/offline-worker.js";
  const [valid] = await eslint.lintText("void self; void caches; void clients;", { filePath });
  assert.deepEqual(valid.messages, []);
  const [invalid] = await eslint.lintText("void document; void window;", { filePath });
  assert.deepEqual(
    invalid.messages.map(({ ruleId }) => ruleId),
    ["no-undef", "no-undef"],
  );
});

test("Node tooling retains Node globals without receiving browser globals", async () => {
  for (const filePath of ["eslint.config.js", "scripts/run-gate.mjs", "server/scripts/check-node.mjs"]) {
    const [valid] = await eslint.lintText("void process; void Buffer;", { filePath });
    assert.deepEqual(valid.messages, [], filePath);
    const [invalid] = await eslint.lintText("void window; void document;", { filePath });
    assert.deepEqual(
      invalid.messages.map(({ ruleId }) => ruleId),
      ["no-undef", "no-undef"],
      filePath,
    );
  }
});
