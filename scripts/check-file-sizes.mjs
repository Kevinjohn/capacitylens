import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function countLines(content) {
  if (content === "") return 0;
  return content.split(/\r?\n/).length - (content.endsWith("\n") ? 1 : 0);
}

// files contains repository-relative paths and source contents; no disk access here.
export function evaluateFileSizes(files, config) {
  const sizes = new Map(files.map(({ path, content }) => [path, countLines(content)]));
  const permanent = new Set(config.permanent.map(({ path }) => path));
  const temporary = new Set(config.temporary.map(({ path }) => path));
  const errors = [];

  for (const { path } of config.permanent) {
    if (!sizes.has(path)) errors.push(`${path}: stale permanent exception, file missing.`);
  }
  for (const { path, baseline } of config.temporary) {
    const lines = sizes.get(path);
    if (lines === undefined) {
      errors.push(`${path}: stale, remove entry (file missing).`);
    } else if (lines <= config.ceiling) {
      errors.push(`${path}: stale, remove entry (${lines} lines, ceiling ${config.ceiling}).`);
    } else if (lines > baseline) {
      errors.push(`${path}: raised to ${lines} lines above baseline ${baseline}.`);
    }
  }
  for (const [path, lines] of sizes) {
    if (lines > config.ceiling && !permanent.has(path) && !temporary.has(path)) {
      errors.push(`${path}: ${lines} lines exceeds ceiling ${config.ceiling}; no exception listed.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function collectSourceFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z", "--", "src", "server/src", "shared/src"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  return result.stdout
    .split("\0")
    .filter(
      (path) =>
        /\.tsx?$/.test(path) &&
        !/\.(test|spec)\./.test(basename(path)) &&
        !path.endsWith(".d.ts") &&
        !path.startsWith("src/paraglide/") &&
        !/(?:^|\/)(?:node_modules|e2e)\//.test(path),
    )
    .map((path) => ({ path, content: readFileSync(join(root, path), "utf8") }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function printFunctionDiagnostics(files) {
  console.log("Function lengths (diagnostic, not enforced):");
  // Deliberately approximate: a top-level declaration through the next column-0 brace.
  const startPattern =
    /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::[^=]+)?=>\s*\{/;
  for (const { path, content } of files) {
    const lines = content.split(/\r?\n/);
    let start = -1;
    let name = "";
    for (let index = 0; index < lines.length; index++) {
      if (start < 0) {
        const match = lines[index].match(startPattern);
        if (match) {
          start = index;
          name = match[1] || match[2];
        }
      } else if (lines[index].startsWith("}")) {
        const length = index - start + 1;
        if (length > 150) console.log(`${path}:${start + 1}: ${name} — approximately ${length} lines.`);
        start = -1;
      }
    }
  }
}

function main() {
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const config = JSON.parse(readFileSync(join(root, "scripts/file-size-exceptions.json"), "utf8"));
    const files = collectSourceFiles(root);
    const result = evaluateFileSizes(files, config);
    if (result.valid) {
      console.log(
        `File-size check passed: ${files.length} source files, ceiling ${config.ceiling}, ${config.temporary.length} temporary exceptions.`,
      );
    } else {
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
    }
    printFunctionDiagnostics(files);
  } catch (error) {
    console.error(`File-size check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
