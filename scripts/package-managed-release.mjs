import { deployManagedRuntime, assertInternalDependencyLinks } from "./deploy-managed-runtime.mjs";
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
import { platform, arch } from "node:process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const generatedMarker = "CapacityLens generated production artifact\n";

/**
 * Requires a nonempty regular file at the given path.
 * @throws When the path is missing, empty, or not a regular file.
 */
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

// `pnpm deploy --prod` selects the dependency graph. This secondary check rejects direct links to
// development-only packages. Framework runtime dependencies can legitimately pull build/test
// packages into the virtual store, so checking every transitive name would reject a valid deploy.
/**
 * Lists development packages not needed by the server or shared runtime.
 * @throws When a package manifest cannot be read or parsed.
 */
export async function readDevelopmentPackages(repositoryRoot) {
  const readManifest = async (path) => JSON.parse(await readFile(join(repositoryRoot, path), "utf8"));
  const manifests = await Promise.all(
    ["package.json", "apps/backend/package.json", "packages/shared/package.json"].map(readManifest),
  );
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
  "backend/public/index.html",
  "backend/bin/server.js",
  "backend/ace.js",
  "backend/database/released.json",
  "backend/pnpm-workspace.yaml",
  "backend/node_modules/@capacitylens/shared/dist/brand.js",
  "capacitylens.env.example",
  "capacitylens.service",
  "capacitylens.nginx.conf",
  "Caddyfile.example",
  "INSTALL.md",
  "VERSION",
];

/**
 * Checks that a managed release has its required files and no forbidden packages.
 * @throws When a required file is missing or a forbidden package is present.
 */
export async function inspectManagedRelease(root, forbiddenPackages) {
  for (const file of requiredReleaseFiles) await requireNonemptyFile(join(root, ...file.split("/")), file);
  const nativeAddon = join(root, "backend", "node_modules", "better-sqlite3", "prebuilds", `${platform}-${arch}.node`);
  await requireNonemptyFile(nativeAddon, `better-sqlite3 native addon for ${platform}-${arch}`);
  const manifest = JSON.parse(await readFile(join(root, "backend", "database", "released.json"), "utf8"));
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0)
    throw new Error("Production artifact has no executable migration manifest entries.");
  for (const migration of manifest.migrations) {
    await requireNonemptyFile(join(root, "backend", `${migration.name}.js`), `${migration.name}.js`);
  }
  const tests = await stat(join(root, "backend", "tests")).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (tests) throw new Error("Production artifact contains compiled tests.");
  const inspectCompiled = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "public") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inspectCompiled(path);
      else if (/\.(?:ts|map)$/.test(entry.name))
        throw new Error(`Production artifact contains a source or source map file: ${relative(root, path)}`);
    }
  };
  await inspectCompiled(join(root, "backend"));

  const modules = join(root, "backend", "node_modules");
  const store = join(modules, ".pnpm");
  const packages = (await readdir(store, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const leaked = [];
  for (const name of forbiddenPackages) {
    const direct = join(modules, ...name.split("/"));
    const present = await lstat(direct).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (present) leaked.push(name);
  }
  if (leaked.length > 0) throw new Error(`Development packages leaked into production: ${leaked.join(", ")}`);
  return { packageCount: packages.length };
}

/** Carry the approved native build policy without deploy paths that escape the artifact. */
export async function carryBuildPolicy(backend, repositoryRoot) {
  const committed = YAML.parse(await readFile(join(repositoryRoot, "pnpm-workspace.yaml"), "utf8"));
  const policy = committed?.allowBuilds;
  if (
    !policy ||
    typeof policy !== "object" ||
    Array.isArray(policy) ||
    Object.keys(policy).length === 0 ||
    Object.values(policy).some((approved) => typeof approved !== "boolean")
  ) {
    throw new Error("Committed build-script policy must be a nonempty map of boolean approvals.");
  }
  await writeFile(join(backend, "pnpm-workspace.yaml"), YAML.stringify({ allowBuilds: policy }));
}

/**
 * Replaces production output after confirming it is generated release content.
 * @throws When existing output fails the generated-content checks.
 */
export async function resetGeneratedOutput(output) {
  // Move the entry aside before inspecting it, so the checks and the deletion apply to the same
  // entry even if production/ is swapped concurrently. A refused entry is moved back.
  const holding = await mkdtemp(join(dirname(output), ".production-retired-"));
  const retired = join(holding, "production");
  try {
    await rename(output, retired);
  } catch (error) {
    // Missing output starts a new artifact; other rename failures refuse replacement, and cleanup failures remain visible.
    await rmdir(holding).catch((cleanup) => console.warn(`Could not remove ${holding}:`, cleanup));
    if (error?.code !== "ENOENT") throw error;
    return createGeneratedOutput(output);
  }
  try {
    await checkGeneratedOutput(retired);
  } catch (refusal) {
    // Restore refused output before surfacing validation failure so unrecognised operator files are preserved.
    await rename(retired, output).catch((error) => {
      // Name the retained artifact location if restoration fails so the operator can recover it.
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

/**
 * Builds and validates the managed production release.
 * @throws When deployment or release validation fails.
 */
export async function packageManagedRelease(outputPath = "production") {
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  if (outputPath !== "production") throw new Error("Production output path must be exactly production/.");
  const output = resolve(repositoryRoot, outputPath);
  await resetGeneratedOutput(output);
  const backend = join(output, "backend");
  await cp(join(repositoryRoot, "apps", "backend", "build"), backend, { recursive: true });
  await rm(join(backend, "tests"), { recursive: true, force: true });
  await rm(join(backend, "bin", "test.js"), { force: true });
  const removeMaps = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "public") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await removeMaps(path);
      else if (entry.name.endsWith(".map")) await rm(path);
    }
  };
  await removeMaps(backend);
  await addReleaseFiles(output, {
    repositoryRoot,
    version: await readVersion(repositoryRoot),
    revision: runChecked("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }).trim(),
  });

  const deployment = join(output, ".runtime-deploy");
  try {
    await deployManagedRuntime(repositoryRoot, deployment, backend);
    await carryBuildPolicy(backend, repositoryRoot);
    await rename(join(deployment, "node_modules"), join(backend, "node_modules"));
    await assertInternalDependencyLinks(backend);
  } finally {
    await rm(deployment, { recursive: true, force: true });
  }
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

/**
 * Refuse operator state and any symlink that resolves outside the release.
 * @throws When the tree contains operator state or escaping symlinks, or filesystem inspection fails.
 */
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

/**
 * Returns the lowercase SHA-256 digest of a file as hexadecimal.
 */
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
 * Writes the generated archive and checksum files.
 * @throws When validation, copying, archive commands or checksum I/O fail.
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
