import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reportSpawnFailureAndResolveExitStatus, spawnPnpmSync } from '../shared/pnpmSpawn.mjs';

const updates = (input) =>
  input
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.trim().split(/\s+/))
    .map(([, localSha = '', remoteRef = '']) => ({ localSha, remoteRef }));

/**
 * Decide whether a push only deletes remote refs, from the lines git passes the pre-push hook.
 *
 * Each line is `<local ref> <local sha> <remote ref> <remote sha>`; a deletion has an all-zero
 * local sha. Empty input is not a deletion, so a push with nothing to update keeps the checks.
 */
export function deletesOnly(input) {
  const lines = updates(input);
  return lines.length > 0 && lines.every(({ localSha }) => /^0+$/.test(localSha));
}

/**
 * Choose the checks for a push: `none`, `changed` or `full`.
 *
 * `changed` checks only the files this branch changed, which is sound when every commit being
 * pushed is the checked-out one going to a branch: the changed-files check reads the working tree.
 * A tag, a branch that is not checked out and a push with nothing to update keep the whole check.
 */
export function pushChecks(input, head) {
  if (deletesOnly(input)) return 'none';
  const sent = updates(input).filter(({ localSha }) => !/^0+$/.test(localSha));
  const checkedOutBranch = ({ localSha, remoteRef }) =>
    localSha === head && remoteRef.startsWith('refs/heads/');
  return sent.length > 0 && sent.every(checkedOutBranch) ? 'changed' : 'full';
}

function runFullCheck() {
  const result = spawnPnpmSync(['run', 'check:push'], { stdio: ['ignore', 'inherit', 'inherit'] });
  return reportSpawnFailureAndResolveExitStatus('check:push', result);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const checks = pushChecks(readFileSync(0, 'utf8'), head);
  if (checks === 'none') {
    console.log('pre-push: the push only deletes remote refs; skipping checks.');
    process.exit(0);
  }
  if (checks === 'full') process.exit(runFullCheck());
  const changed = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./check-changed.mjs', import.meta.url)), '--push'],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  // Status 2 means the changed-files check could not select, such as a clone without origin/main.
  if (changed.status === 0 || changed.status === 1) process.exit(changed.status);
  console.log('pre-push: the changed-files check could not run; running the whole check.');
  process.exit(runFullCheck());
}
