import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDocument, visit } from "yaml";

function parseConfiguration(source) {
  // Retain YAML 1.1 implicit scalar resolution and rejection of aliases,
  // custom objects and timestamps. Ambiguous duplicate keys and extra documents fail too.
  const document = parseDocument(source, { version: "1.1" });
  const diagnostic = [...document.errors, ...document.warnings][0];
  if (diagnostic) throw diagnostic;
  visit(document, {
    Collection(_key, node) {
      if (node.tag === "tag:yaml.org,2002:set")
        throw new Error("YAML sets are not permitted in Dependabot configuration.");
    },
    Scalar(_key, node) {
      if (node.value instanceof Date) throw new Error("YAML timestamps are not permitted in Dependabot configuration.");
    },
  });
  return document.toJS({ maxAliasCount: 0 });
}

/** Validate the existing Dependabot field policy without executing configuration; return its entry count. */
export function validateDependabot(source) {
  const document = parseConfiguration(source);
  if (document?.version !== 2) throw new Error("Dependabot version must be 2");
  const updates = document.updates;
  if (!Array.isArray(updates) || updates.length === 0) throw new Error("Dependabot updates must be a non-empty list");
  for (const entry of updates) {
    if (typeof entry?.["package-ecosystem"] !== "string") throw new Error("Dependabot entry needs package-ecosystem");
    if (typeof entry.directory !== "string") throw new Error("Dependabot entry needs directory");
    if (!["daily", "weekly", "monthly"].includes(entry.schedule?.interval))
      throw new Error("Invalid Dependabot schedule");
  }
  return updates.length;
}

function main() {
  try {
    const [path = fileURLToPath(new URL("../.github/dependabot.yml", import.meta.url)), ...extra] =
      process.argv.slice(2);
    if (extra.length) throw new Error("Expected one optional configuration path.");
    const count = validateDependabot(readFileSync(path, "utf8"));
    console.log(`Dependabot configuration: ${count} update entries verified.`);
  } catch (error) {
    console.error(`Dependabot configuration failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1] !== "-" && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  main();
