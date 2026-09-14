type ComponentIdHash = (value: string) => string;

const PNPM_DEPENDENCY_PATH = /(?:^|\/)node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)(?:\/(.*))?$/;
const DEPENDENCY_PATH = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)(?:\/(.*))?$/;

const packageQualifiedPath = (filepath: string): string => {
  const match = filepath.match(PNPM_DEPENDENCY_PATH) ?? filepath.match(DEPENDENCY_PATH);
  if (match === null) return filepath;

  const packagePath = match[2] === undefined ? match[1] : `${match[1]}/${match[2]}`;
  return `node_modules/${packagePath}`;
};

// Keep Vue's default development and production source sensitivity while removing
// only pnpm/worktree topology from dependency component paths. The callback shape
// is the supported @vitejs/plugin-vue features.componentIdGenerator API:
// https://github.com/vitejs/vite-plugin-vue#options
export const generateDocumentationComponentId = (
  filepath: string,
  source: string,
  isProduction: boolean | undefined,
  getHash: ComponentIdHash,
): string => getHash(packageQualifiedPath(filepath) + (isProduction ? source : ""));
