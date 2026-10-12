/**
 * Modules explicitly accepted without line coverage.
 */
export const ZERO_COVERAGE_ALLOWLIST: ReadonlySet<string>;
/**
 * Returns executable modules with no covered lines.
 */
export function uncoveredExecutableFiles(lcov: string, allowlist?: ReadonlySet<string>): string[];
/**
 * Checks the coverage report and throws when an unapproved module has no covered lines.
 * @throws When the report cannot be read or an unapproved executable module has no covered lines.
 */
export function checkFileCoverage(path?: string): void;
