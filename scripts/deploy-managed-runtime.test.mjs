import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  stageRuntimeSource,
  repairBackendSelfLinks,
  assertInternalDependencyLinks,
} from "./deploy-managed-runtime.mjs";

test("production staging preserves source metadata and carries the compiled shared package", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens_package_source_test_"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const destination = join(root, "staged");
  await mkdir(source);
  execFileSync("git", ["init", "--quiet"], { cwd: source });
  await writeFile(join(source, ".gitignore"), "node_modules\nbuild\ndist\n");
  for (const path of ["node_modules", "apps/backend/build", "packages/shared/dist"])
    await mkdir(join(source, path), { recursive: true });
  await writeFile(join(source, "node_modules/.modules.yaml"), "production-and-development-install");
  await writeFile(join(source, "apps/backend/build/ace.js"), "compiled-ace");
  await writeFile(join(source, "packages/shared/dist/brand.js"), "compiled-shared");
  await writeFile(join(source, "package.json"), "{}");
  await stageRuntimeSource(source, destination);
  assert.equal(
    await readFile(join(source, "node_modules/.modules.yaml"), "utf8"),
    "production-and-development-install",
  );
  assert.equal(await readFile(join(destination, "packages/shared/dist/brand.js"), "utf8"), "compiled-shared");
  await assert.rejects(() => readFile(join(destination, "node_modules/.modules.yaml")), { code: "ENOENT" });
});

test("deployed backend self links target the compiled artifact and every dependency link stays internal", async (context) => {
  const backend = await mkdtemp(join(tmpdir(), "capacitylens_package_links_test_"));
  context.after(() => rm(backend, { recursive: true, force: true }));
  const modules = join(backend, "node_modules");
  const direct = join(modules, "@capacitylens");
  const nested = join(modules, ".pnpm/file+apps+backend/node_modules/@capacitylens");
  await mkdir(direct, { recursive: true });
  await mkdir(nested, { recursive: true });
  await symlink("/private/missing-source", join(direct, "backend"));
  await symlink("/private/missing-source", join(nested, "backend"));
  await repairBackendSelfLinks(modules, backend);
  assert.equal(await readlink(join(direct, "backend")), "../..");
  await assertInternalDependencyLinks(backend);
  await symlink("/private/missing-source", join(modules, "escaping"));
  await assert.rejects(() => assertInternalDependencyLinks(backend));
});
