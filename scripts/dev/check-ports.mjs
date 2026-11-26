// Guard the port lane system against the change that quietly undoes it: someone types a port number back
// into a file that should derive one. The check lists the files that bind or address a
// port lane port, not a tree-wide ban on port literals. Production defaults
// (apps/backend/app/services/configuration.ts), Compose pins, fixture generators, prose and assertion URLs all
// legitimately carry numbers, and failing on those would teach people to work around this check.
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { portsForPortLane } from '../../tooling/ports.mjs';

// Each guarded file must import its ports from tooling/ports.mjs (by path or as
// `@capacitylens/tooling/ports`) and must not spell one out.
/** Authored launch/configuration files that must derive their endpoints from the port registry. */
export const GUARDED_FILES = Object.freeze([
  'apps/frontend/vite.config.ts',
  'playwright.config.ts',
  'scripts/dev/dev-fullstack.mjs',
  'scripts/e2e/serve-dist.mjs',
  'docs-src/.vitepress/config.mts',
  'e2e/authTestKit.ts',
  'e2e/serverTestState.ts',
  'e2e/workerServer.ts',
  'scripts/e2e/e2eWorkerRuntime.mjs',
  'apps/backend/scripts/e2e_server.mjs',
]);

// Port lane 0 holds each base port, so the registry is the only list.
const GUARDED_PORTS = Object.freeze(Object.values(portsForPortLane(0)));

/**
 * Drop comments so prose about a port never fails the check; only executable text is inspected.
 * A `//` preceded by a colon is a URL scheme, not a comment. Dropping the rest of that line would
 * blind the check to `http://localhost:5173`, which is the most likely way a literal comes back.
 */
export function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** Returns port-policy errors without changing the supplied file records or reading from disk. */
export function evaluatePortUsage(files) {
  const errors = [];
  for (const { path, content } of files) {
    const code = stripComments(content);
    // A relative path to tooling/ports.mjs, or the workspace package subpath the backend uses.
    if (!/from\s+["']([^"']*ports\.mjs|@capacitylens\/tooling\/ports)["']/.test(code)) {
      errors.push(`${path}: must import its ports from tooling/ports.mjs.`);
    }
    const workerPortLiterals = code.match(/\b10\d{3}\b/g) ?? [];
    for (const port of new Set([...GUARDED_PORTS, ...workerPortLiterals.map(Number)])) {
      if (new RegExp(`\\b${port}\\b`).test(code)) {
        errors.push(
          `${path}: hardcodes port ${port}. Derive it from tooling/ports.mjs so every lane is correct, not only lane 0.`,
        );
      }
    }
  }
  return errors;
}

function main() {
  const root = new URL('../../', import.meta.url);
  const files = GUARDED_FILES.map((path) => ({
    path,
    content: readFileSync(new URL(path, root), 'utf8'),
  }));
  const errors = evaluatePortUsage(files);
  if (errors.length === 0) return;
  console.error(`Port lane check failed:\n${errors.map((error) => `  ${error}`).join('\n')}`);
  process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url)
  main();
