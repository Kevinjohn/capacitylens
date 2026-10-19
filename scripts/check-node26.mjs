import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { supportsNodeVersion } from "../apps/backend/start/node_version.ts";
import { reportSpawnFailureAndResolveExitStatus, spawnPnpmSync } from "./pnpmSpawn.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const startedAt = performance.now();

function run(label, command, args, environment = process.env) {
  console.log(`Checking ${label}...`);
  const result =
    command === "pnpm"
      ? spawnPnpmSync(args, { cwd: root, stdio: "inherit", env: environment })
      : spawnSync(command, args, { cwd: root, stdio: "inherit", env: environment });
  const status = reportSpawnFailureAndResolveExitStatus(label, result);
  if (status !== 0) throw new Error(`${label} failed with exit status ${status}.`);
}

function capture(command, args) {
  const options = { cwd: root, encoding: "utf8" };
  const result = command === "pnpm" ? spawnPnpmSync(args, options) : spawnSync(command, args, options);
  const status = reportSpawnFailureAndResolveExitStatus(command, result);
  if (status !== 0) throw new Error(`${command} failed with exit status ${status}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Build with isolated validation settings, then smoke a copied artifact outside the checkout. */
export function runDetachedPackageProbe({ repositoryRoot = root, deployDir, runCommand = run }) {
  runCommand("production build", "pnpm", ["run", "build"], {
    ...process.env,
    NODE_ENV: "production",
    CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION: "1",
    HOST: "127.0.0.1",
    PORT: "0",
    LOG_LEVEL: "error",
    APP_KEY: "capacitylens-build-key-0123456789abcdef",
    APP_URL: "http://127.0.0.1",
    SESSION_DRIVER: "memory",
  });
  runCommand("production package", "pnpm", ["run", "package:managed-release"]);
  const detached = join(deployDir, "production");
  cpSync(join(repositoryRoot, "production"), detached, { recursive: true, verbatimSymlinks: true });
  runCommand("deployed runtime smoke", "pnpm", ["run", "smoke:packaged-server", join(detached, "backend")]);
}

function main() {
  let deployDir;
  let passed = false;
  try {
    const pnpmVersion = capture("pnpm", ["--version"]);
    const pinnedPnpm = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
      .packageManager.split("@")
      .at(-1);
    const commit = capture("git", ["rev-parse", "HEAD"]);
    const dirty = capture("git", ["status", "--porcelain=v1", "--untracked-files=all"]).length > 0;
    console.log(
      JSON.stringify({
        node: process.version,
        pnpm: pnpmVersion,
        pinnedPnpm,
        pnpmPinMatches: pnpmVersion === pinnedPnpm,
        commit,
        dirty,
        platform: process.platform,
        arch: process.arch,
      }),
    );
    if (pnpmVersion !== pinnedPnpm) throw new Error(`Expected pinned pnpm ${pinnedPnpm}; found ${pnpmVersion}.`);
    const version = process.versions.node;
    if (!version.startsWith("26.") || !supportsNodeVersion(version)) {
      throw new Error(`check:node26 requires selected Node >=26.9.0 <27; found ${process.version}.`);
    }

    deployDir = mkdtempSync(join(tmpdir(), "capacitylens-node26-deploy-"));
    run("browser storage regression", "pnpm", [
      "--dir",
      "apps/frontend",
      "exec",
      "vitest",
      "run",
      "src/test/storageCompatibility.test.ts",
    ]);
    run("backend lifecycle regressions", "pnpm", [
      "--dir",
      "apps/backend",
      "test",
      "--files=tests/unit/app_reset_command.spec.ts",
      "--files=tests/unit/owner_reset_command.spec.ts",
      "--files=tests/unit/backup.spec.ts",
    ]);
    runDetachedPackageProbe({ deployDir });
    passed = true;
  } finally {
    if (deployDir) rmSync(deployDir, { recursive: true, force: true });
    console.log(
      JSON.stringify({
        result: passed ? "passed" : "failed",
        elapsedSeconds: Math.round((performance.now() - startedAt) / 1000),
      }),
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
