import { cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const forbiddenRuntimePackages = [
  "@playwright+test",
  "@stryker-mutator+",
  "@types+",
  "@vitejs+",
  "@vitest+",
  "esbuild",
  "eslint",
  "playwright",
  "playwright-core",
  "simple-git-hooks",
  "tailwindcss",
  "tsx",
  "typescript",
  "vite",
  "vitepress",
  "vitest",
];
const generatedMarker = "CapacityLens generated production artifact\n";

async function requireNonemptyFile(path, label) {
  const details = await stat(path).catch(() => undefined);
  if (!details?.isFile() || details.size === 0) throw new Error(`Production artifact is missing ${label}.`);
}

export async function inspectManagedRelease(root) {
  await requireNonemptyFile(join(root, "dist", "index.html"), "dist/index.html");
  await requireNonemptyFile(join(root, "server", "dist", "index.mjs"), "server/dist/index.mjs");
  await requireNonemptyFile(join(root, "server", "dist", "importWorker.mjs"), "server/dist/importWorker.mjs");

  const store = join(root, "server", "node_modules", ".pnpm");
  const packages = (await readdir(store, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const leaked = forbiddenRuntimePackages.filter((name) =>
    packages.some((entry) => entry === name || entry.startsWith(name.endsWith("+") ? name : `${name}@`)),
  );
  if (leaked.length > 0) throw new Error(`Development packages leaked into production: ${leaked.join(", ")}`);
  return { packageCount: packages.length };
}

export async function resetGeneratedOutput(output) {
  const existing = await lstat(output).catch(() => undefined);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error("Refusing to replace production/: it is not a generated directory.");
    }
    const marker = await readFile(join(output, ".capacitylens-generated-release"), "utf8").catch(() => undefined);
    if (marker !== generatedMarker) {
      throw new Error("Refusing to replace production/: it is not a CapacityLens-generated artifact.");
    }
    await rm(output, { recursive: true });
  }
  await mkdir(output, { recursive: true });
  await writeFile(join(output, ".capacitylens-generated-release"), generatedMarker);
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
  return inspectManagedRelease(output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await packageManagedRelease(process.argv[2]);
  console.log(`Production artifact contains ${result.packageCount} stored runtime packages.`);
}
