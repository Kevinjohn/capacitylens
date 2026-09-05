import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectSourceInventory } from "./source-inventory.mjs";
import { measureFunctions } from "./function-metrics.mjs";
import { measureShellFunctions } from "./shell-function-metrics.mjs";
import { measureVueFunctions } from "./vue-function-metrics.mjs";
import { evaluateFunctionBudgets, functionLimits } from "./function-budgets.mjs";

const collectors = {
  javascript: measureFunctions,
  typescript: measureFunctions,
  shell: measureShellFunctions,
  vue: measureVueFunctions,
};
const physicalOnly = new Set(["css", "html"]);

/**
 * Measure inventoried JS/TS, Vue and shell source without executing it. Preserve ownership and
 * source coordinates. CSS/HTML retain physical budgets; embedded code in these formats and
 * configuration/patches remains outside this function gate. The JSON report lists all exclusions,
 * including data such as package.json that can also contain executable command strings.
 */
export async function measureSourceFunctions(file, content) {
  if (physicalOnly.has(file.language)) return [];
  const collect = Object.hasOwn(collectors, file.language) && collectors[file.language];
  if (!collect) throw new Error(`Unsupported function language: ${file.path} (${file.language}).`);
  return (await collect(content, file.path)).map((entry) => ({ path: file.path, role: file.role, ...entry }));
}

/** Inventory every source path, measuring supported functions and explicitly listing other coverage. */
export async function collectFunctionInventory(root) {
  const inventory = collectSourceInventory(root);
  const files = inventory.filter(({ category }) => category === "source");
  const units = [];
  for (const file of files) {
    units.push(...(await measureSourceFunctions(file, readFileSync(join(root, file.path), "utf8"))));
  }
  return {
    files: files.map(({ path, role, language }) => ({ path, role, language, functions: !physicalOnly.has(language) })),
    unmeasured: inventory.filter(({ category, language }) => category !== "source" || physicalOnly.has(language)),
    units,
  };
}

async function main() {
  try {
    if (process.argv.slice(2).some((arg) => arg !== "--json")) throw new Error("Expected no arguments or --json.");
    const root = fileURLToPath(new URL("../", import.meta.url));
    const inventory = await collectFunctionInventory(root);
    const exceptions = JSON.parse(readFileSync(join(root, "scripts/function-budget-exceptions.json"), "utf8"));
    const tasks = readFileSync(join(root, "tasks/todo.md"), "utf8");
    const taskIds = new Set([...tasks.matchAll(/^### (T\d{2})\b/gm)].map((match) => match[1]));
    const result = evaluateFunctionBudgets(inventory.units, exceptions, taskIds);
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify({ limits: functionLimits, ...inventory, exceptions, ...result }, null, 2));
    } else {
      console.log(
        `Function budgets: ${inventory.units.length} units in ${inventory.files.filter((file) => file.functions).length} files; ` +
          `limits ${JSON.stringify(functionLimits)}; ${exceptions.length} bounded metric exceptions.`,
      );
      console.log(
        "Coverage: JS/TS functions and class scopes, Vue authored regions, shell declarations. " +
          "Other embedded code remains queued; --json lists paths outside function coverage.",
      );
      for (const error of result.errors) console.error(error);
    }
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    console.error(`Function budgets failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  process.argv[1] !== "-" &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  await main();
}
