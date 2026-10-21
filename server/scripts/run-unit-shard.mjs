import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectory = fileURLToPath(new URL("../src/", import.meta.url));
const isolatedSuites = new Set([
  "src/accounts/conformance/accountFlows.conformance.test.ts",
  "src/credentialOnboardingDurability.test.ts",
  "src/rehearseMigrations.test.ts",
]);

function collectTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collectTestFiles(path);
    if (!entry.isFile() || !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return [relative(serverDirectory, path).split(sep).join("/")];
  });
}

function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) throw new Error("Expected a shard argument such as 1/4.");
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (index < 1 || total < 1 || index > total) {
    throw new Error(`Invalid shard ${value}; the index must be between 1 and ${total}.`);
  }
  return { index, total };
}

const [shardValue = "1/1", ...options] = process.argv.slice(2).filter((argument) => argument !== "--");
const { index, total } = parseShard(shardValue);
const files = collectTestFiles(sourceDirectory)
  .filter((file) => !isolatedSuites.has(file))
  .sort()
  .filter((_, fileIndex) => fileIndex % total === index - 1);

if (files.length === 0) throw new Error(`Server unit shard ${shardValue} contains no test files.`);

console.log(`Server unit shard ${shardValue}: ${files.length} fresh Vitest processes`);
if (options.includes("--list")) {
  console.log(files.join("\n"));
  process.exit(0);
}

for (const file of files) {
  console.log(`\n[server-unit ${shardValue}] ${file}`);
  const result = spawnSync("pnpm", ["exec", "vitest", "run", file, "--pool=forks", "--no-file-parallelism"], {
    cwd: serverDirectory,
    env: process.env,
    stdio: "inherit",
    timeout: 90_000,
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`Failed to complete ${file}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
