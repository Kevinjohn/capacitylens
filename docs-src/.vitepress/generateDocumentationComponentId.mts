type ComponentIdHash = (value: string) => string;

const PNPM_DEPENDENCY_PATH = /(?:^|\/)node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)(?:\/(.*))?$/;
const DEPENDENCY_PATH = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)(?:\/(.*))?$/;

const packageQualifiedPath = (filepath: string): string => {
  const match = filepath.match(PNPM_DEPENDENCY_PATH) ?? filepath.match(DEPENDENCY_PATH);
  if (match === null) return filepath;

  const packagePath = match[2] === undefined ? match[1] : `${match[1]}/${match[2]}`;
  return `node_modules/${packagePath}`;
};

/** Normalizes dependency paths before hashing so pnpm and worktree layout do not change component IDs.
 * Development IDs omit source text; production IDs include it, matching Vue's default behavior.
 */
export const generateDocumentationComponentId = (
  filepath: string,
  source: string,
  isProduction: boolean | undefined,
  getHash: ComponentIdHash,
): string => getHash(packageQualifiedPath(filepath) + (isProduction ? source : ""));
