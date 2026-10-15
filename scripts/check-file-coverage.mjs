import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Explicitly accepted modules without line coverage.
 * Additions require policy review; use exact paths so new untested modules remain detectable.
 */
export const ZERO_COVERAGE_ALLOWLIST = new Set([
  "../../packages/shared/src/account/sessionPolicy.ts",
  "src/components/ui/skeleton.tsx",
]);

/**
 * Returns executable modules with no covered lines.
 */
export function uncoveredExecutableFiles(lcov, allowlist = ZERO_COVERAGE_ALLOWLIST) {
  const failures = [];
  let source = null;
  let linesFound = 0;
  let linesHit = 0;

  const finish = () => {
    if (source && linesFound > 0 && linesHit === 0 && !allowlist.has(source)) {
      failures.push(source);
    }
    source = null;
    linesFound = 0;
    linesHit = 0;
  };

  for (const line of lcov.split(/\r?\n/u)) {
    if (line.startsWith("SF:")) {
      finish();
      source = line.slice(3).replaceAll("\\", "/");
    } else if (line.startsWith("LF:")) {
      linesFound = Number.parseInt(line.slice(3), 10);
    } else if (line.startsWith("LH:")) {
      linesHit = Number.parseInt(line.slice(3), 10);
    } else if (line === "end_of_record") {
      finish();
    }
  }
  finish();
  return failures.sort();
}

/**
 * Checks the coverage report and throws when an unapproved module has no covered lines.
 * @throws When the report cannot be read or an unapproved executable module has no covered lines.
 */
export function checkFileCoverage(path = "apps/frontend/coverage/lcov.info") {
  const lcov = readFileSync(resolve(path), "utf8");
  const failures = uncoveredExecutableFiles(lcov);
  if (failures.length === 0) return;
  throw new Error(
    `Coverage contains wholly untested executable modules:\n${failures.map((file) => `- ${file}`).join("\n")}`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    checkFileCoverage(process.argv[2]);
  } catch (error) {
    // Surface report and coverage failures through stderr and a failing exit status.
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
