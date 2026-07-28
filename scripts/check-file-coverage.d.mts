export const ZERO_COVERAGE_ALLOWLIST: ReadonlySet<string>;
export function uncoveredExecutableFiles(lcov: string, allowlist?: ReadonlySet<string>): string[];
export function checkFileCoverage(path?: string): void;
