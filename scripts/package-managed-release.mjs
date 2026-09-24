import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const generatedMarker = "CapacityLens generated production artifact\n";

async function requireNonemptyFile(path, label) {
  const details = await stat(path).catch(() => undefined);
  if (!details?.isFile() || details.size === 0) throw new Error(`Production artifact is missing ${label}.`);
}

// `pnpm deploy --prod` is the primary guard. This secondary check forbids every direct
// devDependency of the root and server manifests that the server does not also list as a runtime
// dependency, so the list follows the manifests instead of a hand-kept sample.
export async function readDevelopmentPackages(repositoryRoot) {
  const readManifest = async (path) => JSON.parse(await readFile(join(repositoryRoot, path), "utf8"));
  const [rootManifest, serverManifest] = await Promise.all([
    readManifest("package.json"),
    readManifest("server/package.json"),
  ]);
  const runtime = new Set(Object.keys(serverManifest.dependencies ?? {}));
  const development = [
    ...Object.keys(rootManifest.devDependencies ?? {}),
    ...Object.keys(serverManifest.devDependencies ?? {}),
  ];
  return [...new Set(development)].filter((name) => !runtime.has(name)).sort();
}

export async function inspectManagedRelease(root, forbiddenPackages) {
  await requireNonemptyFile(join(root, "dist", "index.html"), "dist/index.html");
  await requireNonemptyFile(join(root, "server", "dist", "index.mjs"), "server/dist/index.mjs");
  await requireNonemptyFile(join(root, "server", "dist", "importWorker.mjs"), "server/dist/importWorker.mjs");

  const store = join(root, "server", "node_modules", ".pnpm");
  const packages = (await readdir(store, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  // The pnpm store names `@scope/name@1.2.3` as `@scope+name@1.2.3`.
  const leaked = forbiddenPackages.filter((name) =>
    packages.some((entry) => entry.startsWith(`${name.replace("/", "+")}@`)),
  );
  if (leaked.length > 0) throw new Error(`Development packages leaked into production: ${leaked.join(", ")}`);
  return { packageCount: packages.length };
}

export async function resetGeneratedOutput(output) {
  // Move the entry aside before inspecting it, so the checks and the deletion apply to the same
  // entry even if production/ is swapped concurrently. A refused entry is moved back.
  const holding = await mkdtemp(join(dirname(output), ".production-retired-"));
  const retired = join(holding, "production");
  const moved = await rename(output, retired).then(
    () => true,
    async (error) => {
      await rmdir(holding);
      if (error?.code === "ENOENT") return false;
      throw error;
    },
  );
  if (moved) {
    const refusal = await checkGeneratedOutput(retired);
    if (refusal) {
      await rename(retired, output);
      await rmdir(holding);
      throw new Error(refusal);
    }
    await rm(holding, { recursive: true });
  }
  await mkdir(output, { recursive: true });
  await writeFile(join(output, ".capacitylens-generated-release"), generatedMarker);
}

async function checkGeneratedOutput(path) {
  const existing = await lstat(path);
  if (!existing.isDirectory() || existing.isSymbolicLink()) {
    return "Refusing to replace production/: it is not a generated directory.";
  }
  const marker = await readFile(join(path, ".capacitylens-generated-release"), "utf8").catch(() => undefined);
  if (marker !== generatedMarker) {
    return "Refusing to replace production/: it is not a CapacityLens-generated artifact.";
  }
  return undefined;
}

export async function packageManagedRelease(outputPath = "production") {
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  if (outputPath !== "production") throw new Error("Production output path must be exactly production/.");
  const output = resolve(repositoryRoot, outputPath);
  await resetGeneratedOutput(output);
  await cp(join(repositoryRoot, "dist"), join(output, "dist"), { recursive: true });

  const deployed = spawnSync("pnpm", ["--filter", "capacitylens-server", "deploy", "--prod", join(output, "server")], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (deployed.status !== 0) throw new Error(`pnpm deploy failed with status ${deployed.status ?? "unknown"}.`);
  return inspectManagedRelease(output, await readDevelopmentPackages(repositoryRoot));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await packageManagedRelease(process.argv[2]);
  console.log(`Production artifact contains ${result.packageCount} stored runtime packages.`);
}
