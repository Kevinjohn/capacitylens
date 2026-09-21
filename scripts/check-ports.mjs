// Guard the lane system against the change that quietly undoes it: someone types a port number back
// into a file that should derive one. The check is a WHITELIST of the files that bind or address a
// lane port, not a tree-wide ban on port literals — production defaults
// (server/src/routes/appConfig.ts), Compose pins, fixture generators, prose and assertion URLs all
// legitimately carry numbers, and failing on those would teach people to work around this check.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Each guarded file must import its ports from scripts/ports.mjs and must not spell one out.
export const GUARDED_FILES = Object.freeze([
  "vite.config.ts",
  "playwright.config.ts",
  "scripts/dev-fullstack.mjs",
  "scripts/serve-dist.mjs",
  "scripts/dev-access-lab.mjs",
  "docs-src/.vitepress/config.mts",
  "e2e/auth-helpers.ts",
  "e2e/db-helpers.ts",
  "server/scripts/e2e-server.mjs",
]);

// The lane bases, and the fixed OIDC ports that scripts/ports.mjs also owns.
const GUARDED_PORTS = Object.freeze([4173, 5173, 5273, 5373, 5473, 5900, 5910, 8787, 8887, 8897]);

/**
 * Drop comments so prose about a port never fails the check; only executable text is inspected.
 * A `//` preceded by a colon is a URL scheme, not a comment — dropping the rest of that line would
 * blind the check to `http://localhost:5173`, which is the most likely way a literal comes back.
 */
export function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

export function evaluatePortUsage(files) {
  const errors = [];
  for (const { path, content } of files) {
    const code = stripComments(content);
    if (!/from\s+"[^"]*ports\.mjs"/.test(code)) {
      errors.push(`${path}: must import its ports from scripts/ports.mjs.`);
    }
    for (const port of GUARDED_PORTS) {
      if (new RegExp(`\\b${port}\\b`).test(code)) {
        errors.push(
          `${path}: hardcodes port ${port}. Derive it from scripts/ports.mjs so every lane is correct, not only lane 0.`,
        );
      }
    }
  }
  return errors;
}

function main() {
  const root = new URL("../", import.meta.url);
  const files = GUARDED_FILES.map((path) => ({ path, content: readFileSync(new URL(path, root), "utf8") }));
  const errors = evaluatePortUsage(files);
  if (errors.length === 0) return;
  console.error(`Port lane check failed:\n${errors.map((error) => `  ${error}`).join("\n")}`);
  process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) main();
