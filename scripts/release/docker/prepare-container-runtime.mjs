import {
  cp,
  lstat,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

/** Carry the approved native build policy without deploy paths that escape the artifact. */
export async function carryBuildPolicy(backend, repositoryRoot) {
  const committed = YAML.parse(await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8'));
  const policy = committed?.allowBuilds;
  if (
    !policy ||
    typeof policy !== 'object' ||
    Array.isArray(policy) ||
    Object.keys(policy).length === 0 ||
    Object.values(policy).some((approved) => typeof approved !== 'boolean')
  ) {
    throw new Error('Committed build-script policy must be a nonempty map of boolean approvals.');
  }
  await writeFile(join(backend, 'pnpm-workspace.yaml'), YAML.stringify({ allowBuilds: policy }));
}

/** Redirect package self references to the final compiled backend rather than source-only files. */
export async function repairBackendSelfLinks(modules, backend) {
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (
        entry.isSymbolicLink() &&
        entry.name === 'backend' &&
        dirname(path).endsWith('/@capacitylens')
      ) {
        const finalPath = join(backend, 'node_modules', relative(modules, path));
        await unlink(path);
        await symlink(relative(dirname(finalPath), backend), path);
      }
    }
  };
  await visit(modules);
}

/** Reject dependency links that escape the final artifact, including absolute paths and broken links. */
export async function assertInternalDependencyLinks(root) {
  const canonicalRoot = await realpath(root);
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if ((await lstat(path)).isSymbolicLink()) {
        const target = await readlink(path);
        const resolved = await realpath(path);
        if (
          target.startsWith('/') ||
          (resolved !== canonicalRoot && !resolved.startsWith(`${canonicalRoot}/`))
        )
          throw new Error(
            `Production dependency link escapes the artifact: ${relative(root, path)}`,
          );
      }
    }
  };
  await visit(root);
}

async function removeSourceMaps(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await removeSourceMaps(path);
    else if (entry.name.endsWith('.map')) await rm(path);
  }
}

/** Assemble the compiled standalone container runtime after disposable pnpm legacy deployment. */
export async function prepareContainerRuntime(repositoryRoot, deployment, backend) {
  await cp(join(repositoryRoot, 'apps/backend/build'), backend, { recursive: true });
  await rm(join(backend, 'tests'), { recursive: true, force: true });
  await rm(join(backend, 'bin/test.js'), { force: true });
  await removeSourceMaps(backend);
  await carryBuildPolicy(backend, repositoryRoot);
  await repairBackendSelfLinks(join(deployment, 'node_modules'), backend);
  await rename(join(deployment, 'node_modules'), join(backend, 'node_modules'));
  await assertInternalDependencyLinks(backend);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3)
    throw new Error('Expected repository, deployment and backend directories.');
  await prepareContainerRuntime(...args.map((path) => resolve(path)));
}
