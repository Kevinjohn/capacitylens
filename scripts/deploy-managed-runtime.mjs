import { cp, lstat, mkdir, mkdtemp, readdir, readlink, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

function checked(args, cwd) {
  const result = spawnSync("pnpm", args, { cwd, stdio: "inherit" });
  if (result.error) throw new Error("Production dependency operation could not start", { cause: result.error });
  if (result.signal || result.status !== 0)
    throw new Error(`Production dependency operation failed (${result.signal ?? result.status})`);
}

/** Copy only repository inputs and compiled packages, leaving source installation metadata untouched. */
export async function stageRuntimeSource(repositoryRoot, destination) {
  const listing = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (listing.error || listing.status !== 0)
    throw new Error("Could not list production source inputs", { cause: listing.error });
  for (const file of new Set(listing.stdout.split("\0").filter(Boolean))) {
    if (file.split("/").includes("node_modules")) continue;
    const target = join(destination, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(repositoryRoot, file), target, { verbatimSymlinks: true });
  }
  for (const path of ["apps/backend/build", "packages/shared/dist"])
    await cp(join(repositoryRoot, path), join(destination, path), { recursive: true });
}

/** Redirect package self references to the final compiled backend rather than source-only files. */
export async function repairBackendSelfLinks(modules, backend) {
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isSymbolicLink() && entry.name === "backend" && dirname(path).endsWith("/@capacitylens")) {
        const finalPath = join(backend, "node_modules", relative(modules, path));
        await unlink(path);
        await symlink(relative(dirname(finalPath), backend), path);
      }
    }
  };
  await visit(modules);
}

/** Deploy the frozen production graph in disposable source, never in the developer's installation. */
export async function deployManagedRuntime(repositoryRoot, deployment, backend) {
  const source = await mkdtemp(join(tmpdir(), "capacitylens_package_source_"));
  try {
    await stageRuntimeSource(repositoryRoot, source);
    checked(["--filter", "@capacitylens/backend...", "install", "--frozen-lockfile", "--ignore-scripts"], source);
    // The pinned local archive is resolved correctly by legacy deploy; dedicated-lockfile deploy tries the registry.
    checked(["--filter", "@capacitylens/backend", "deploy", "--prod", "--legacy", deployment], source);
    await repairBackendSelfLinks(join(deployment, "node_modules"), backend);
  } finally {
    await rm(source, { recursive: true, force: true });
  }
}

/** Reject dependency links that escape the final artifact, including absolute paths and broken links. */
export async function assertInternalDependencyLinks(root) {
  const { realpath } = await import("node:fs/promises");
  const canonicalRoot = await realpath(root);
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if ((await lstat(path)).isSymbolicLink()) {
        const target = await readlink(path);
        const resolved = await realpath(path);
        if (target.startsWith("/") || (resolved !== canonicalRoot && !resolved.startsWith(`${canonicalRoot}/`)))
          throw new Error(`Production dependency link escapes the artifact: ${relative(root, path)}`);
      }
    }
  };
  await visit(root);
}
