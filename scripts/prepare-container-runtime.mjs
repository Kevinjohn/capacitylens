import { cp, readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { carryBuildPolicy } from "./package-managed-release.mjs";
import { assertInternalDependencyLinks, repairBackendSelfLinks } from "./deploy-managed-runtime.mjs";

async function removeSourceMaps(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await removeSourceMaps(path);
    else if (entry.name.endsWith(".map")) await rm(path);
  }
}

/** Assemble the compiled standalone container runtime after disposable pnpm legacy deployment. */
export async function prepareContainerRuntime(repositoryRoot, deployment, backend) {
  await cp(join(repositoryRoot, "apps/backend/build"), backend, { recursive: true });
  await rm(join(backend, "tests"), { recursive: true, force: true });
  await rm(join(backend, "bin/test.js"), { force: true });
  await removeSourceMaps(backend);
  await carryBuildPolicy(backend, repositoryRoot);
  await repairBackendSelfLinks(join(deployment, "node_modules"), backend);
  await rename(join(deployment, "node_modules"), join(backend, "node_modules"));
  await assertInternalDependencyLinks(backend);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw new Error("Expected repository, deployment and backend directories.");
  await prepareContainerRuntime(...args.map((path) => resolve(path)));
}
