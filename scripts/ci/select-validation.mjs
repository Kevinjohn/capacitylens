// Decide whether a main push needs Validation, or repeats a tree a manual run already passed:
//
//   node scripts/ci/select-validation.mjs    print `run` or `skip` for the checked-out commit
//
// A pull request merged into an unchanged main gives a merge commit with the same tree as the pull
// request's head. A manual Validation run is never narrower than a main push run, so one that
// passed on that head has already tested this tree. Any doubt, such as a failed lookup, selects
// `run`. The sign-off check reads the pushed commits rather than the tree, so it never skips.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Decide whether Validation runs for a pushed commit.
 *
 * `skip` needs all of: a two-parent merge, a tree equal to the tree of its second parent (the merged
 * branch head), and a successful manual Validation run on that parent. Everything else is `run`.
 */
export function selectValidation({ parents, tree, mergedTree, validatedRunUrl }) {
  if (parents.length !== 2)
    return { scope: 'run', reason: 'the commit is not a merge of one branch' };
  if (!tree || tree !== mergedTree)
    return {
      scope: 'run',
      reason: 'main had moved, so the merged tree differs from the branch head',
    };
  if (!validatedRunUrl)
    return { scope: 'run', reason: `no successful manual Validation run on ${parents[1]}` };
  return { scope: 'skip', reason: `the identical tree passed ${validatedRunUrl}` };
}

function output(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

/** Read the checked-out commit and the run history; a failed read leaves the value empty. */
export function readCommit(read = output, repository = process.env.GH_REPO) {
  const attempt = (command, args) => {
    try {
      return read(command, args);
    } catch {
      return '';
    }
  };
  const [, ...parents] = attempt('git', ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ');
  if (parents.length !== 2) return { parents, tree: '', mergedTree: '', validatedRunUrl: '' };
  return {
    parents,
    tree: attempt('git', ['rev-parse', 'HEAD^{tree}']),
    mergedTree: attempt('git', ['rev-parse', `${parents[1]}^{tree}`]),
    validatedRunUrl: attempt('gh', [
      'api',
      `repos/${repository}/actions/workflows/validation.yml/runs?head_sha=${parents[1]}&event=workflow_dispatch&status=success&per_page=1`,
      '--jq',
      '.workflow_runs[0].html_url // empty',
    ]),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { scope, reason } = selectValidation(readCommit());
  console.error(`select-validation: ${scope}, ${reason}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Validation\n\n${scope === 'skip' ? 'Skipped' : 'Selected'}: ${reason}.\n\n`,
    );
  console.log(scope);
}
