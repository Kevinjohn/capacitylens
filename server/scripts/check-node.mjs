import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const SUPPORTED_RANGE = "Node >=24.19.0 <25 or >=26.9.0 <27";

/** Returns whether the exact runtime version is admitted for server execution. */
export function supportsNodeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return (
    (major === 24 && (minor > 19 || (minor === 19 && patch >= 0))) ||
    (major === 26 && (minor > 9 || (minor === 9 && patch >= 0)))
  );
}

/** Refuses an unadmitted runtime before the caller can read or write application data. */
export function assertSupportedNodeVersion(version = process.versions.node) {
  if (!supportsNodeVersion(version)) {
    throw new Error(
      `capacitylens-server requires ${SUPPORTED_RANGE}; found Node ${version}. Use \`nvm use\` for the default Node 24 runtime.`,
    );
  }
}

if (
  process.argv[1] &&
  basename(fileURLToPath(import.meta.url)) === "check-node.mjs" &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  try {
    assertSupportedNodeVersion();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
