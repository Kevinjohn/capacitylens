const explicitSpecPath = /(?:^|[/\\])e2e[/\\].+\.spec\.(?:ts|tsx|mts|cts)$/i;
const serverBackedSpec = /\.(?:db|auth|oidc)\.spec\.(?:ts|tsx|mts|cts)$/i;

/**
 * Detect the common focused-run form without guessing what arbitrary Playwright
 * file-filter regular expressions or directories might select.
 */
export function selectsOnlyExplicitCoreSpecs(argv: readonly string[]): boolean {
  const explicitSpecs = argv.filter((argument) => !argument.startsWith("-") && explicitSpecPath.test(argument));

  return explicitSpecs.length > 0 && explicitSpecs.every((argument) => !serverBackedSpec.test(argument));
}
