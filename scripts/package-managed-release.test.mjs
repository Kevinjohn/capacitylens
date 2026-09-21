import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectManagedRelease, packageManagedRelease, resetGeneratedOutput } from "./package-managed-release.mjs";

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

test("accepts the complete production runtime", async (context) => {
  const root = await makeRelease(["better-auth@1.6.30", "fastify@5.12.3"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = await inspectManagedRelease(root);
  assert.equal(result.packageCount, 2);
});

test("rejects development tooling in the production runtime", async (context) => {
  const root = await makeRelease(["better-auth@1.6.30", "simple-git-hooks@2.14.0"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => inspectManagedRelease(root), /simple-git-hooks/);
});

test("rejects an artifact without the import worker", async (context) => {
  const root = await makeRelease();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "server", "dist", "importWorker.mjs"), "");
  await assert.rejects(() => inspectManagedRelease(root), /importWorker\.mjs/);
});

test("rejects every output path except the dedicated production directory", async () => {
  await assert.rejects(() => packageManagedRelease("dist"), /exactly production/);
  await assert.rejects(() => packageManagedRelease("../outside"), /exactly production/);
});

test("does not delete an unowned production directory", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-output-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "production");
  await mkdir(output);
  await writeFile(join(output, "keep.txt"), "operator data");

  await assert.rejects(() => resetGeneratedOutput(output), /not a CapacityLens-generated artifact/);
  assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "operator data");
});

test("replaces only a marked generated artifact", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-output-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "production");

  await resetGeneratedOutput(output);
  await writeFile(join(output, "stale.txt"), "stale");
  await resetGeneratedOutput(output);

  await assert.rejects(() => readFile(join(output, "stale.txt")), /ENOENT/);
  assert.match(await readFile(join(output, ".capacitylens-generated-release"), "utf8"), /generated/);
});

test("does not follow a production-directory symlink", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-output-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "target");
  const output = join(root, "production");
  await resetGeneratedOutput(target);
  await symlink(target, output);

  await assert.rejects(() => resetGeneratedOutput(output), /not a generated directory/);
  assert.match(await readFile(join(target, ".capacitylens-generated-release"), "utf8"), /generated/);
});
