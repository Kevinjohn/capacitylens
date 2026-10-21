import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checker = fileURLToPath(new URL("./check-crypto-inventory.mjs", import.meta.url));

for (const source of [
  'import { randomUUID } from "node:crypto";',
  'const { randomUUID } = require( "node:crypto");',
  'const crypto = await import("node:crypto");',
]) {
  test(`recognizes a reviewed cryptography import: ${source}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "crypto-inventory-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "docs-src/security"), { recursive: true });
    writeFileSync(
      join(root, "docs-src/security/crypto-inventory.json"),
      JSON.stringify({
        entries: [{ path: "identity.mjs", purpose: "Non-secret identifiers" }],
      }),
    );
    writeFileSync(join(root, "identity.mjs"), source);
    for (const args of [
      ["init", "--quiet"],
      ["add", "identity.mjs"],
    ]) {
      const git = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      assert.equal(git.status, 0, git.stderr);
    }
    const result = spawnSync(process.execPath, [checker], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 implementation paths match/);
  });
}
