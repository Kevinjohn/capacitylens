const explicitSpecPath = /(?:^|[/\\])e2e[/\\].+\.spec\.(?:ts|tsx|mts|cts)$/i;
const serverBackedSpec = /\.(?:db|auth|oidc)\.spec\.(?:ts|tsx|mts|cts)$/i;
export const coreSpecPattern = /^(?!.*\.(?:db|auth|oidc)\.spec\.(?:ts|tsx|mts|cts)$).*\.spec\.(?:ts|tsx|mts|cts)$/i;

/** Keep report paths non-empty and reject lossy aliases instead of merging nominally distinct runs. */
export function reportPhaseName(value: string | undefined): string {
  if (!value) return "default";
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error("CAPACITYLENS_E2E_PHASE may contain only letters, numbers, underscores and hyphens.");
  }
  return value;
}

/**
 * Detect the common focused-run form without guessing what arbitrary Playwright
 * file-filter regular expressions or directories might select.
 */
export function selectsOnlyExplicitCoreSpecs(argv: readonly string[]): boolean {
  const explicitSpecs = argv.filter((argument) => !argument.startsWith("-") && explicitSpecPath.test(argument));

  return explicitSpecs.length > 0 && explicitSpecs.every((argument) => !serverBackedSpec.test(argument));
}
