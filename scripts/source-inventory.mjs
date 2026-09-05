import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const languages = new Map([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".vue", "vue"],
  [".sh", "shell"],
  [".css", "css"],
  [".html", "html"],
]);
const categories = new Map([
  [".md", "prose"],
  [".json", "data"],
  [".tsv", "data"],
  [".db", "asset"],
  [".svg", "asset"],
  [".jpg", "asset"],
  [".png", "asset"],
  [".woff2", "asset"],
  [".yml", "configuration"],
  [".yaml", "configuration"],
  [".toml", "configuration"],
  [".conf", "configuration"],
  [".patch", "patch"],
]);
const configurationNames = new Set([
  ".dockerignore",
  ".git-blame-ignore-revs",
  ".gitattributes",
  ".gitignore",
  ".nvmrc",
  ".prettierignore",
  ".trivyignore",
  "Dockerfile",
]);
const configurationPaths = new Set([".env.example", "nginx.client.conf.template"]);

function validatePath(path) {
  if (
    typeof path !== "string" ||
    /[\\\0:]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Invalid repository path: ${path}`);
  }
}

function sourceRole(path) {
  if (/\.d\.[cm]?ts$/.test(path)) return "declaration";
  if (
    /\.(test|spec)\./.test(basename(path)) ||
    path.startsWith("e2e/") ||
    path.startsWith("src/test/") ||
    path.split("/").includes("__tests__") ||
    // This child-process entry point is used only by the credential durability test.
    path === "server/src/fixtures/credentialOnboardingCrashFixture.ts"
  )
    return "test";
  return "production";
}

/**
 * Classify a portable repository-relative path without reading its contents.
 * Unknown formats fail closed. Configuration and patches may contain embedded code;
 * their classification does not claim that JavaScript function metrics cover them.
 */
export function classifyRepositoryPath(path) {
  validatePath(path);
  if (path.startsWith("docs/") || path.startsWith("src/paraglide/")) return { category: "generated" };
  const language = languages.get(extname(path));
  if (language) return { category: "source", language, role: sourceRole(path) };
  if (path === "LICENSE") return { category: "prose" };
  if (configurationNames.has(basename(path)) || configurationPaths.has(path)) return { category: "configuration" };
  const category = categories.get(extname(path));
  if (category) return { category };
  throw new Error(`Unclassified repository path: ${path}`);
}

function existingFile(root, path) {
  try {
    if (!lstatSync(join(root, path)).isFile()) throw new Error(`Unsupported repository entry: ${path}`);
    return true;
  } catch (error) {
    // A tracked file deleted in the working tree is absent from the current inventory.
    // Its former structural exception must consequently become stale in the budget check.
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Inventory tracked and untracked nonignored working-tree files, once each in path order.
 * Reject unsupported entries and unknown formats; never follow a file symlink or read assets.
 * Generated files remain visible as classified exclusions. Deleted tracked files are omitted.
 */
export function collectSourceInventory(root) {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  const paths = [...new Set(result.stdout.split("\0").filter(Boolean))].sort();
  return paths.flatMap((path) => {
    validatePath(path);
    if (!existingFile(root, path)) return [];
    return [{ path, ...classifyRepositoryPath(path) }];
  });
}

function main() {
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const inventory = collectSourceInventory(root);
    if (process.argv.slice(2).some((arg) => arg !== "--json")) throw new Error("Expected no arguments or --json.");
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(inventory, null, 2));
    } else {
      const counts = {};
      for (const { category } of inventory) counts[category] = (counts[category] ?? 0) + 1;
      console.log(`Source inventory passed (files: ${inventory.length}); ${JSON.stringify(counts)}.`);
    }
  } catch (error) {
    console.error(`Source inventory failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1] !== "-" && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  main();
