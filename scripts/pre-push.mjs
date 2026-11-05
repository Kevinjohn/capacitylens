import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { reportSpawnFailureAndResolveExitStatus, spawnPnpmSync } from './pnpmSpawn.mjs';

/**
 * Decide whether a push only deletes remote refs, from the lines git passes the pre-push hook.
 *
 * Each line is `<local ref> <local sha> <remote ref> <remote sha>`; a deletion has an all-zero
 * local sha. Empty input is not a deletion, so a push with nothing to update keeps the checks.
 */
export function deletesOnly(input) {
  const lines = input.split('\n').filter((line) => line.trim() !== '');
  return lines.length > 0 && lines.every((line) => /^0+$/.test(line.trim().split(/\s+/)[1] ?? ''));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (deletesOnly(readFileSync(0, 'utf8'))) {
    console.log('pre-push: the push only deletes remote refs; skipping checks.');
    process.exit(0);
  }
  const result = spawnPnpmSync(['run', 'check:push'], { stdio: ['ignore', 'inherit', 'inherit'] });
  process.exit(reportSpawnFailureAndResolveExitStatus('check:push', result));
}
