import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectManagedRelease } from "./package-managed-release.mjs";

async function makeRelease(packages = []) {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-release-test-"));
  await mkdir(join(root, "dist"), { recursive: true });
  await mkdir(join(root, "server", "dist"), { recursive: true });
  await mkdir(join(root, "server", "node_modules", ".pnpm"), { recursive: true });
  await writeFile(join(root, "dist", "index.html"), "<!doctype html>");
  await writeFile(join(root, "server", "dist", "index.mjs"), "export {};");
  await writeFile(join(root, "server", "dist", "importWorker.mjs"), "export {};");
  await Promise.all(
    packages.map((name) => mkdir(join(root, "server", "node_modules", ".pnpm", name), { recursive: true })),
  );
  return root;
}

test("accepts the complete production runtime", async () => {
  const root = await makeRelease(["better-auth@1.6.30", "fastify@5.12.3"]);
  const result = await inspectManagedRelease(root);
  assert.equal(result.packageCount, 2);
});

test("rejects development tooling in the production runtime", async () => {
  const root = await makeRelease(["better-auth@1.6.30", "simple-git-hooks@2.14.0"]);
  await assert.rejects(() => inspectManagedRelease(root), /simple-git-hooks/);
});

test("rejects an artifact without the import worker", async () => {
  const root = await makeRelease();
  await writeFile(join(root, "server", "dist", "importWorker.mjs"), "");
  await assert.rejects(() => inspectManagedRelease(root), /importWorker\.mjs/);
});
