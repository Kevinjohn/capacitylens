// Publication waits for proof. The tag push that publishes is also the push that validates the
// tag, and nothing orders the two workflows' runs, so publication would not wait for the checks.
// This script makes it wait:
//
//   RELEASE_TAG=v1.2.3 GH_REPO=owner/repo node scripts/release/require-release-validation.mjs
//
// It passes only when the latest push run of every required workflow, for that tag and the commit
// the tag names, completed successfully. It waits while a run is queued or in progress or has not
// appeared yet, and fails on any other conclusion or at the deadline. The Docker workflow is not
// required: its publish job builds and smokes the images it pushes, and its own tag run cannot
// wait for itself.

import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

/** Workflows whose tag-push run must succeed before a release is published. */
export const REQUIRED_WORKFLOWS = Object.freeze([{ file: 'validation.yml', name: 'Validation' }]);

/**
 * Judge one workflow's runs for a tag push: `pass`, `wait` or `fail`, with the reason.
 *
 * Only push runs of this tag at this commit count, and only the most recent of them, so a
 * successful re-run supersedes an earlier failure.
 */
export function judgeRuns(runs, { tag, sha, name }) {
  const matching = runs
    .filter((run) => run.event === 'push' && run.head_branch === tag && run.head_sha === sha)
    .toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const [latest] = matching;
  if (!latest) return { state: 'wait', reason: `${name}: no run for the push of ${tag} yet` };
  if (latest.status !== 'completed')
    return { state: 'wait', reason: `${name}: run ${latest.html_url} is ${latest.status}` };
  if (latest.conclusion === 'success')
    return { state: 'pass', reason: `${name}: run ${latest.html_url} succeeded` };
  return {
    state: 'fail',
    reason: `${name}: run ${latest.html_url} concluded ${latest.conclusion}`,
  };
}

/** Combine per-workflow judgements: any failure fails, then any wait waits, else pass. */
export function combine(judgements) {
  for (const state of ['fail', 'wait'])
    if (judgements.some((judgement) => judgement.state === state)) return state;
  return 'pass';
}

/**
 * Poll until every required workflow passes, one fails, or the deadline passes.
 *
 * `readRuns(file)` returns that workflow's runs for the commit; `now` and `wait` are injectable so
 * the polling can be tested without time passing.
 */
export async function requireValidation({
  tag,
  sha,
  readRuns,
  deadlineMs,
  intervalMs = 30_000,
  now = Date.now,
  wait = sleep,
  log = console.log,
  workflows = REQUIRED_WORKFLOWS,
}) {
  const stopAt = now() + deadlineMs;
  for (;;) {
    const judgements = workflows.map((workflow) =>
      judgeRuns(readRuns(workflow.file), { tag, sha, name: workflow.name }),
    );
    for (const judgement of judgements) log(`${judgement.state}  ${judgement.reason}`);
    const state = combine(judgements);
    if (state !== 'wait') return state;
    if (now() + intervalMs > stopAt) {
      log(`fail  ${tag} was not validated within ${Math.round(deadlineMs / 60_000)} minutes`);
      return 'fail';
    }
    await wait(intervalMs);
  }
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

async function main() {
  const tag = process.env.RELEASE_TAG;
  const repo = process.env.GH_REPO;
  if (!tag || !repo) {
    console.error('RELEASE_TAG and GH_REPO are required.');
    process.exit(2);
  }
  const deadlineMs = Number(process.env.VALIDATION_DEADLINE_MINUTES ?? 120) * 60_000;
  const sha = gh(['api', `repos/${repo}/commits/${encodeURIComponent(tag)}`, '--jq', '.sha']);
  console.log(`Requiring successful validation of ${tag} at ${sha}`);
  const readRuns = (file) =>
    JSON.parse(
      gh([
        'api',
        `repos/${repo}/actions/workflows/${file}/runs?event=push&head_sha=${sha}&per_page=100`,
        '--jq',
        '.workflow_runs',
      ]),
    );
  const state = await requireValidation({ tag, sha, readRuns, deadlineMs });
  if (state !== 'pass') {
    console.error(`::error::${tag} is not validated, so nothing is published.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
