import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const generatedMarker = "CapacityLens generated production artifact\n";

export async function requireNonemptyFile(path, label) {
  // Only a missing entry means "missing"; any other stat failure is reported as itself.
  const details = await stat(path).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw new Error(`Could not inspect ${path}: ${error.message}`, { cause: error });
  });
  if (!details?.isFile() || details.size === 0) throw new Error(`Production artifact is missing ${label}.`);
}

/** Report a deploy that could not start or was terminated before its exit status. */
export function assertDeploySucceeded(result) {
  if (result.error) throw new Error(`pnpm deploy could not start: ${result.error.message}`, { cause: result.error });
  if (result.signal) throw new Error(`pnpm deploy was terminated by ${result.signal}.`);
  if (result.status !== 0) throw new Error(`pnpm deploy failed with status ${result.status ?? "unknown"}.`);
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

// Every file an operator needs from the release, relative to its root. packaging/release/ supplies
// the operator files; the packager writes VERSION.
const requiredReleaseFiles = [
  "dist/index.html",
  "server/dist/index.mjs",
  "server/dist/importWorker.mjs",
  "server/dist/reset-owner-password.mjs",
  "server/scripts/check-node.mjs",
  "capacitylens.env.example",
  "capacitylens.service",
  "capacitylens.nginx.conf",
  "Caddyfile.example",
  "INSTALL.md",
  "VERSION",
];

export async function inspectManagedRelease(root, forbiddenPackages) {
  for (const file of requiredReleaseFiles) await requireNonemptyFile(join(root, ...file.split("/")), file);

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
  try {
    await rename(output, retired);
  } catch (error) {
    await rmdir(holding).catch((cleanup) => console.warn(`Could not remove ${holding}:`, cleanup));
    if (error?.code !== "ENOENT") throw error;
    return createGeneratedOutput(output);
  }
  try {
    await checkGeneratedOutput(retired);
  } catch (refusal) {
    await rename(retired, output).catch((error) => {
      throw new Error(`Could not restore production/; it was left at ${retired}.`, { cause: error });
    });
    await rmdir(holding);
    throw refusal;
  }
  await rm(holding, { recursive: true });
  return createGeneratedOutput(output);
}

async function createGeneratedOutput(output) {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, ".capacitylens-generated-release"), generatedMarker);
}

// Resolves for a generated artifact; any refusal or read failure rejects.
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
}

function runChecked(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args[0]} failed with status ${result.status ?? result.signal}: ${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

/** Copy the operator files and record which version and source revision the release was built from. */
export async function addReleaseFiles(output, { repositoryRoot, version, revision }) {
  await cp(join(repositoryRoot, "packaging", "release"), output, { recursive: true });
  // The guide's download lines name the exact release, so they can be pasted as they are.
  const guide = join(output, "INSTALL.md");
  await writeFile(guide, (await readFile(guide, "utf8")).replaceAll("X.Y.Z", version));
  await writeFile(join(output, "VERSION"), `version=${version}\nrevision=${revision}\n`);
}

async function readVersion(repositoryRoot) {
  return JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).version;
}

export async function packageManagedRelease(outputPath = "production") {
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  if (outputPath !== "production") throw new Error("Production output path must be exactly production/.");
  const output = resolve(repositoryRoot, outputPath);
  await resetGeneratedOutput(output);
  await cp(join(repositoryRoot, "dist"), join(output, "dist"), { recursive: true });
  await addReleaseFiles(output, {
    repositoryRoot,
    version: await readVersion(repositoryRoot),
    revision: runChecked("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }).trim(),
  });

  const deployed = spawnSync("pnpm", ["--filter", "capacitylens-server", "deploy", "--prod", join(output, "server")], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  assertDeploySucceeded(deployed);
  return inspectManagedRelease(output, await readDevelopmentPackages(repositoryRoot));
}

// Operator state that must never ship: environment files hold secrets; databases, backups and audit
// logs hold customer data. A release is built from a clean tree, so any of these means a mistake.
const operatorStatePatterns = [
  [/^\.env(?:\..+)?$|\.env$/, "an environment file"],
  [/\.db(?:$|[-.])/, "a database file"],
  [/^backups$/, "a backup directory"],
  [/-audit\.jsonl/, "an audit log"],
];

/** Refuse operator state and any symlink that resolves outside the release. */
export async function inspectArchiveTree(root) {
  const refusals = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const shown = relative(root, path);
      for (const [pattern, description] of operatorStatePatterns) {
        if (pattern.test(entry.name) && !entry.name.endsWith(".example")) refusals.push(`${shown} is ${description}`);
      }
      if (entry.isSymbolicLink()) {
        const target = await readlink(path);
        const resolved = resolve(directory, target);
        if (isAbsolute(target) || (resolved !== root && !resolved.startsWith(`${root}${sep}`))) {
          refusals.push(`${shown} links outside the release (${target})`);
        }
      } else if (entry.isDirectory()) {
        await visit(path);
      }
    }
  };
  await visit(root);
  if (refusals.length > 0) throw new Error(`Refusing to archive the release:\n  ${refusals.join("\n  ")}`);
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Archive the generated production/ release as release/capacitylens-<version>.tar.gz, unpacking to a
 * single capacitylens-<version>/ folder, plus a checksum file in `sha256sum -c` format. Members are
 * owned by root (0:0) so that `sudo tar -x` never hands the code to a local account that happens to
 * share the build machine's uid.
 */
export async function packageReleaseArchive() {
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const source = join(repositoryRoot, "production");
  await checkGeneratedOutput(source);
  await inspectManagedRelease(source, await readDevelopmentPackages(repositoryRoot));
  await inspectArchiveTree(source);

  const name = `capacitylens-${await readVersion(repositoryRoot)}`;
  const outputDirectory = join(repositoryRoot, "release");
  await mkdir(outputDirectory, { recursive: true });
  // Stage a copy under the archive's folder name; tar implementations disagree on renaming flags.
  const staging = await mkdtemp(join(outputDirectory, ".staging-"));
  try {
    await cp(source, join(staging, name), { recursive: true, verbatimSymlinks: true });
    const archive = join(outputDirectory, `${name}.tar.gz`);
    runChecked("tar", ["--owner=0", "--group=0", "--numeric-owner", "-czf", archive, "-C", staging, name], {
      // Keeps macOS tar from adding AppleDouble metadata files; ignored elsewhere.
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    await writeFile(`${archive}.sha256`, `${await sha256File(archive)}  ${basename(archive)}\n`);
    return { archive, checksum: `${archive}.sha256` };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--archive") {
    const { archive, checksum } = await packageReleaseArchive();
    console.log(`Release archive: ${relative(process.cwd(), archive)}\nChecksum: ${relative(process.cwd(), checksum)}`);
  } else {
    const result = await packageManagedRelease(process.argv[2]);
    console.log(`Production artifact contains ${result.packageCount} stored runtime packages.`);
  }
}
