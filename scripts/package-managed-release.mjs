import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const generatedMarker = "CapacityLens generated production artifact\n";

async function requireNonemptyFile(path, label) {
  const details = await stat(path).catch(() => undefined);
  if (!details?.isFile() || details.size === 0) throw new Error(`Production artifact is missing ${label}.`);
}

// `pnpm deploy --prod` is the primary guard. This secondary check follows the manifests instead
// of a hand-kept sample: it forbids every devDependency of the root, server and shared manifests
// that the server or shared does not also need at runtime, and the whole scope of a scoped
// devDependency (for example `@vitest/`), whose tooling arrives transitively.
export async function readDevelopmentPackages(repositoryRoot) {
  const readManifest = async (path) => JSON.parse(await readFile(join(repositoryRoot, path), "utf8"));
  const manifests = await Promise.all(["package.json", "server/package.json", "shared/package.json"].map(readManifest));
  const runtime = new Set(manifests.slice(1).flatMap((manifest) => Object.keys(manifest.dependencies ?? {})));
  const runtimeScopes = new Set([...runtime].filter((name) => name.startsWith("@")).map(scopeOf));
  const development = manifests.flatMap((manifest) => Object.keys(manifest.devDependencies ?? {}));
  const names = development.filter((name) => !runtime.has(name));
  const scopes = names
    .filter((name) => name.startsWith("@"))
    .map(scopeOf)
    .filter((scope) => !runtimeScopes.has(scope));
  return [...new Set([...names, ...scopes])].sort();
}

function scopeOf(name) {
  return `${name.slice(0, name.indexOf("/"))}/`;
}

export async function inspectManagedRelease(root, forbiddenPackages) {
  await requireNonemptyFile(join(root, "dist", "index.html"), "dist/index.html");
  await requireNonemptyFile(join(root, "server", "dist", "index.mjs"), "server/dist/index.mjs");
  await requireNonemptyFile(join(root, "server", "dist", "importWorker.mjs"), "server/dist/importWorker.mjs");

  const store = join(root, "server", "node_modules", ".pnpm");
  const packages = (await readdir(store, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  // The pnpm store names `@scope/name@1.2.3` as `@scope+name@1.2.3`; a scope entry ends in `/`.
  const leaked = forbiddenPackages.filter((name) => {
    const storeName = name.replace("/", "+");
    return packages.some((entry) => entry.startsWith(name.endsWith("/") ? storeName : `${storeName}@`));
  });
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
      await rmdir(holding).catch((cleanup) => console.warn(`Could not remove ${holding}:`, cleanup));
      if (error?.code === "ENOENT") return false;
      throw error;
    },
  );
  if (moved) {
    const refusal = await checkGeneratedOutput(retired).catch((error) => error);
    if (refusal) {
      await rename(retired, output).catch((error) => {
        throw new Error(`Could not restore production/; it was left at ${retired}.`, { cause: error });
      });
      await rmdir(holding);
      throw refusal;
    }
    await rm(holding, { recursive: true });
  }
  await mkdir(output, { recursive: true });
  await writeFile(join(output, ".capacitylens-generated-release"), generatedMarker);
}

// Returns undefined for a generated artifact; any refusal or read failure rejects.
async function checkGeneratedOutput(path) {
  const existing = await lstat(path);
  if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error("Refusing to replace production/: it is not a generated directory.");
  }
  // Only a missing marker means "not ours"; any other read failure is reported as itself.
  const marker = await readFile(join(path, ".capacitylens-generated-release"), "utf8").catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (marker !== generatedMarker) {
    throw new Error("Refusing to replace production/: it is not a CapacityLens-generated artifact.");
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
