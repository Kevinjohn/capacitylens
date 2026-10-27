import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION_PATTERN =
  /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function versionMajor(version, label) {
  const match = typeof version === "string" && VERSION_PATTERN.exec(version);
  if (!match) throw new Error(`Invalid ${label} version: ${String(version)}`);
  return Number(match[1]);
}

/** Parse pnpm's recursive depth-zero listing into direct, registry-backed workspace dependencies. */
export function parseInstalledDependencies(source, repositoryRoot) {
  const workspaces = JSON.parse(source);
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new Error("pnpm list must return a non-empty workspace list");
  }

  const dependencies = [];
  for (const workspace of workspaces) {
    if (typeof workspace?.path !== "string") throw new Error("pnpm workspace entry needs an absolute path");
    const relativePath = path.relative(repositoryRoot, workspace.path);
    if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      throw new Error(`pnpm workspace is outside the repository: ${workspace.path}`);
    }
    const workspaceName = relativePath || ".";

    for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const listed = workspace[group] ?? {};
      if (typeof listed !== "object" || Array.isArray(listed)) {
        throw new Error(`pnpm ${group} must be an object for workspace ${workspaceName}`);
      }
      for (const [manifestName, dependency] of Object.entries(listed)) {
        const installed = dependency?.version;
        // Local file and workspace dependencies have no registry release to compare.
        if (
          [installed, dependency?.resolved].some(
            (value) => typeof value === "string" && /^(?:file|link|workspace):/.test(value),
          )
        )
          continue;
        versionMajor(installed, `installed ${manifestName}`);
        const name = dependency.from ?? manifestName;
        if (typeof name !== "string" || !name)
          throw new Error(`pnpm dependency needs a package name in ${workspaceName}`);
        dependencies.push({ name, workspace: workspaceName, installed });
      }
    }
  }
  return dependencies;
}

/** Compare installed direct dependencies with their current npm `latest` dist-tag versions. */
export function findMajorUpdates(dependencies, latestByPackage) {
  const updates = dependencies.flatMap(({ name, workspace, installed }) => {
    if (!latestByPackage.has(name)) throw new Error(`Registry lookup did not return a latest version for ${name}`);
    const latest = latestByPackage.get(name);
    if (versionMajor(latest, `latest ${name}`) > versionMajor(installed, `installed ${name}`)) {
      return [{ name, workspace, installed, latest }];
    }
    return [];
  });
  return updates.sort(
    (left, right) => left.name.localeCompare(right.name) || left.workspace.localeCompare(right.workspace),
  );
}

/** Render a dated standing-issue body, including an explicit empty report. */
export function renderReport(updates, date) {
  const lines = [
    "Monthly report of newer major releases for direct workspace dependencies.",
    "",
    `Report date: ${date}`,
    "",
  ];
  if (updates.length === 0) {
    lines.push("No direct dependency has a newer major version available.");
  } else {
    lines.push("| Package | Workspace | Installed | Latest |", "| --- | --- | --- | --- |");
    for (const { name, workspace, installed, latest } of updates) {
      lines.push(
        `| \`${name.replaceAll("|", "\\|")}\` | \`${workspace.replaceAll("|", "\\|")}\` | \`${installed}\` | \`${latest}\` |`,
      );
    }
  }
  lines.push("", "This report does not change dependencies or open upgrade pull requests.", "");
  return lines.join("\n");
}

function getLatestVersion(name) {
  const value = execFileSync("pnpm", ["view", `${name}@latest`, "version", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return JSON.parse(value);
}

function main() {
  if (process.argv.length !== 2) throw new Error("Usage: report-major-dependencies.mjs");
  const outputPath = process.env.MAJOR_DEPENDENCY_REPORT_FILE;

  const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const listing = execFileSync("pnpm", ["list", "--recursive", "--depth", "0", "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const dependencies = parseInstalledDependencies(listing, repositoryRoot);
  const names = [...new Set(dependencies.map(({ name }) => name))];
  const versions = names.map((name) => [name, getLatestVersion(name)]);
  const report = renderReport(findMajorUpdates(dependencies, new Map(versions)), new Date().toISOString().slice(0, 10));
  if (outputPath) writeFileSync(outputPath, report);
  else process.stdout.write(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`Major dependency report failed: ${error.message}`);
    process.exitCode = 1;
  }
}
