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

/** Validate Dependabot structure without executing configuration; return its entry count. */
export function verifyDependabotConfiguration(source) {
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

/** Validate the repository's weekly npm and monthly infrastructure update policy. */
export function verifyDependencyUpdatePolicy(source) {
  const updates = parseConfiguration(source)?.updates;
  const byEcosystem = new Map();
  for (const entry of updates ?? []) {
    const ecosystem = entry["package-ecosystem"];
    if (byEcosystem.has(ecosystem)) throw new Error(`Duplicate Dependabot ecosystem: ${ecosystem}`);
    byEcosystem.set(ecosystem, entry);
  }
  if (byEcosystem.size !== 3 || !["npm", "github-actions", "docker"].every((name) => byEcosystem.has(name))) {
    throw new Error("Dependabot must configure npm, github-actions and docker exactly once");
  }

  const npm = byEcosystem.get("npm");
  if (npm.schedule?.interval !== "weekly") throw new Error("npm updates must run weekly");
  const openPullRequestsLimit = npm["open-pull-requests-limit"];
  if (openPullRequestsLimit !== 2) {
    throw new Error("npm open-pull-requests-limit must be 2 for the separate patch and minor groups");
  }
  const groups = npm.groups;
  if (JSON.stringify(Object.keys(groups ?? {}).sort()) !== JSON.stringify(["minor", "patch"])) {
    throw new Error("npm must configure only separate patch and minor groups");
  }
  for (const [name, type] of [
    ["patch", "patch"],
    ["minor", "minor"],
  ]) {
    const updateTypes = groups?.[name]?.["update-types"];
    if (!Array.isArray(updateTypes) || updateTypes.length !== 1 || updateTypes[0] !== type) {
      throw new Error(`npm must group ${type} updates separately`);
    }
  }
  const npmIgnores = npm.ignore;
  if (
    !Array.isArray(npmIgnores) ||
    npmIgnores.length !== 1 ||
    npmIgnores[0]?.["dependency-name"] !== "*" ||
    JSON.stringify(npmIgnores[0]?.["update-types"]) !== JSON.stringify(["version-update:semver-major"])
  ) {
    throw new Error("npm must ignore only automatic major updates");
  }

  for (const ecosystem of ["github-actions", "docker"]) {
    const entry = byEcosystem.get(ecosystem);
    if (entry.schedule?.interval !== "monthly") throw new Error(`${ecosystem} updates must remain monthly`);
    const updateTypes = entry.ignore?.[0]?.["update-types"];
    if (
      entry.ignore?.length !== 1 ||
      entry.ignore[0]?.["dependency-name"] !== "*" ||
      !Array.isArray(updateTypes) ||
      updateTypes.length !== 2 ||
      !updateTypes.includes("version-update:semver-minor") ||
      !updateTypes.includes("version-update:semver-major")
    ) {
      throw new Error(`${ecosystem} updates must remain patch-only`);
    }
  }
  return true;
}

function main() {
  try {
    const [path = fileURLToPath(new URL("../.github/dependabot.yml", import.meta.url)), ...extra] =
      process.argv.slice(2);
    if (extra.length) throw new Error("Expected one optional configuration path.");
    const source = readFileSync(path, "utf8");
    const count = verifyDependabotConfiguration(source);
    verifyDependencyUpdatePolicy(source);
    console.log(`Dependabot configuration: ${count} update entries and repository policy verified.`);
  } catch (error) {
    // Surface invalid or unreadable configuration and fail the checker rather than accepting partial validation.
    console.error(`Dependabot configuration failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1] !== "-" && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  main();
