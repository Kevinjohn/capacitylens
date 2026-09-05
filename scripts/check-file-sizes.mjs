import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectSourceInventory } from "./source-inventory.mjs";

/** Count physical lines, including comments and blank lines; a final newline ends the last line. */
export function countLines(content) {
  if (content === "") return 0;
  return content.split(/\r?\n/).length - (content.endsWith("\n") ? 1 : 0);
}

function hasFields(value, fields) {
  return value !== null && typeof value === "object" && Object.keys(value).sort().join(",") === fields;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function exceptionError(entry, taskIds) {
  if (!hasFields(entry, "baseline,path,reason,task")) return "Expected path, baseline, reason and task.";
  if (["path", "reason", "task"].some((key) => typeof entry[key] !== "string" || !entry[key].trim())) {
    return "Exception path, reason and task must be nonempty strings.";
  }
  if (!positiveInteger(entry.baseline)) return "Exception baseline must be a positive integer.";
  if (!taskIds.has(entry.task)) return `Unknown exception task ${entry.task}; expected a heading in tasks/todo.md.`;
  return null;
}

function configErrors(config, taskIds) {
  if (!hasFields(config, "ceilings,exceptions"))
    return ["Expected ceilings and bounded exceptions; no permanent exemptions."];
  const errors = [];
  if (
    !hasFields(config.ceilings, "declaration,production,test") ||
    !Object.values(config.ceilings).every(positiveInteger)
  ) {
    errors.push("Expected positive integer ceilings for production, test and declaration source.");
  }
  if (!Array.isArray(config.exceptions)) return [...errors, "Expected an exceptions array."];
  const seen = new Set();
  for (const [index, entry] of config.exceptions.entries()) {
    const error = exceptionError(entry, taskIds);
    if (error) {
      errors.push(`Exception ${index + 1}: ${error}`);
      continue;
    }
    if (seen.has(entry.path)) errors.push(`${entry.path}: duplicate exception.`);
    seen.add(entry.path);
  }
  return errors;
}

function budgetError(entry, file, ceiling) {
  if (!file) return `${entry.path}: stale, remove entry (file missing).`;
  if (file.lines <= ceiling) return `${entry.path}: stale, remove entry (${file.lines} lines, ceiling ${ceiling}).`;
  if (entry.baseline <= ceiling) return `${entry.path}: baseline ${entry.baseline} must exceed ceiling ${ceiling}.`;
  if (file.lines > entry.baseline)
    return `${entry.path}: raised to ${file.lines} lines above baseline ${entry.baseline}.`;
  return null;
}

/**
 * Evaluate inventoried source contents without I/O. Every exception has an exact path, growth cap,
 * reason and cleanup task. taskIds is the set of headings from the task ledger. Reject invalid
 * policy, unknown task references/roles, growth and stale/resolved entries.
 */
export function evaluateFileSizes(files, config, taskIds) {
  const errors = configErrors(config, taskIds);
  if (errors.length) return { valid: false, errors };
  const sizes = new Map(files.map(({ path, role, content }) => [path, { role, lines: countLines(content) }]));
  const exceptions = new Set(config.exceptions.map(({ path }) => path));
  for (const [path, file] of sizes) {
    if (!Object.hasOwn(config.ceilings, file.role)) {
      errors.push(`${path}: unknown source role ${file.role}.`);
      continue;
    }
    const ceiling = config.ceilings[file.role];
    if (file.lines > ceiling && !exceptions.has(path)) {
      errors.push(`${path}: ${file.lines} lines exceeds ceiling ${ceiling}; no exception listed.`);
    }
  }
  for (const entry of config.exceptions) {
    const file = sizes.get(entry.path);
    const error = budgetError(entry, file, config.ceilings[file?.role]);
    if (error) errors.push(error);
  }
  return { valid: errors.length === 0, errors };
}

/** Read all tracked and untracked nonignored source from the canonical inventory, preserving role. */
export function collectSourceFiles(root) {
  return collectSourceInventory(root)
    .filter(({ category }) => category === "source")
    .map(({ path, role }) => ({ path, role, content: readFileSync(join(root, path), "utf8") }));
}

function main() {
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const config = JSON.parse(readFileSync(join(root, "scripts/file-size-exceptions.json"), "utf8"));
    const files = collectSourceFiles(root);
    const tasks = readFileSync(join(root, "tasks/todo.md"), "utf8");
    const taskIds = new Set([...tasks.matchAll(/^### (T\d{2})\b/gm)].map((match) => match[1]));
    const result = evaluateFileSizes(files, config, taskIds);
    if (result.valid) {
      console.log(
        `File-size check passed: ${files.length} source files; ceilings ${JSON.stringify(config.ceilings)}; ` +
          `${config.exceptions.length} bounded exceptions.`,
      );
    } else {
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`File-size check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1] !== "-" && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  main();
