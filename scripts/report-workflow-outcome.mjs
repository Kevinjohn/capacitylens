// Reports an unattended workflow outcome as a GitHub issue, and closes that issue once the
// workflow is healthy again.
//
// A failure on a schedule or on `main` has no pull-request audience, so this script records it.
//
// Three judgements make this harder than "if it failed, file an issue", and all three live in
// `decide` below so they can be tested without GitHub:
//
// 1. A cancelled run is not automatically a problem. The security workflow sets
//    `cancel-in-progress: true`, so pushing twice in quick succession cancels the first run by
//    design. That is healthy and must stay silent. But a run cancelled while it is still the tip
//    of its branch was cancelled by something else: a runner outage, a queue timeout, someone
//    hitting the button. That is the failure mode most likely to go unnoticed, because it
//    produces no logs to read. The discriminator is therefore whether the commit is still the
//    branch tip, not the cancellation itself.
//
// 2. Reporting avoids transient noise. A green run closes the open report: a
//    transient failure that fixes itself on the next run closes itself too, and an issue that
//    stays open means something that is still broken.
//
// 3. Reconcile duplicate reports. A repeat failure comments on the oldest open issue, and a new
//    report rereads after publishing and closes visible duplicates. GitHub has no atomic
//    label-keyed create, so concurrent stale-list races converge on a later push or scheduled run.
//
// Scope: this decides and reports. It cannot prove the workflow reaches it during a hard
// cancellation. GitHub gives remaining jobs only a short grace window once a run is cancelled,
// and that is a property of the platform, not of this file.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Label used to find and deduplicate the unattended security-workflow failure report. */
export const ISSUE_LABEL = 'security-scan-failure';
/** Title used when opening the unattended security-workflow failure report. */
export const ISSUE_TITLE = 'Security workflow is failing';

/** Selects open, comment, close or none from workflow results and branch state without changing inputs or performing I/O. */
export function decide({ results, headSha, branchTip, existingIssue }) {
  const failed = results.filter((entry) => entry.result === 'failure');
  const cancelled = results.filter((entry) => entry.result === 'cancelled');

  // "skipped" is not a problem. Most jobs here are conditional on the event.
  if (failed.length === 0 && cancelled.length === 0) {
    return existingIssue
      ? { action: 'close', jobs: [], reason: 'the workflow is healthy again' }
      : { action: 'none', jobs: [], reason: 'the workflow succeeded and no report is open' };
  }

  // A cancellation on a commit that is no longer the branch tip is `cancel-in-progress` doing its
  // job. Only stay silent when the newer commit is known: if the tip could not be read, report
  // rather than assume, because a missed outage costs more than a redundant issue.
  if (failed.length === 0 && branchTip && branchTip !== headSha) {
    return {
      action: 'none',
      jobs: [],
      reason: `cancelled by a newer push (${branchTip.slice(0, 7)}), which is not a failure`,
    };
  }

  const jobs = failed.length > 0 ? failed : cancelled;
  const kind = failed.length > 0 ? 'failed' : 'was cancelled without completing';
  return {
    action: existingIssue ? 'comment' : 'open',
    jobs: jobs.map((entry) => entry.job),
    reason: `the workflow ${kind}`,
  };
}

// Parses the `job=result` lines the workflow passes in. Written as text rather than JSON because
// it is assembled from `needs.*.result` expressions in YAML, where quoting JSON is a trap.
/** Parses newline-separated job=result records, dropping blank lines and records whose parsed job or result is empty. */
export function parseResults(raw) {
  return (raw ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('=');
      return { job: line.slice(0, separator), result: line.slice(separator + 1) };
    })
    .filter((entry) => entry.job && entry.result);
}

/** Builds a failure-report body from the decision and workflow context without publishing it. */
export function buildBody({ decision, context }) {
  const lines = [
    `The \`${context.workflow}\` workflow ${decision.reason}, on a run nobody is watching.`,
    '',
    `- Trigger: \`${context.eventName}\` on \`${context.ref}\``,
    `- Commit: ${context.headSha}`,
    `- Jobs: ${decision.jobs.length > 0 ? decision.jobs.join(', ') : 'none reported — the run failed outside the jobs this check covers'}`,
    `- Run: ${context.runUrl}`,
    '',
    'This issue closes itself when the workflow next completes cleanly, so an open report means something still needs attention.',
  ];
  return lines.join('\n');
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

// Reading the branch tip is best-effort: the API call can fail during the very outage this report
// exists to surface. A null tip means "unknown", which `decide` treats as "report it".
function readBranchTip({ refName, eventName }) {
  // Only a branch can be superseded by a newer push. A tag always resolves to its own commit.
  if (eventName !== 'push' && eventName !== 'schedule') return null;
  try {
    return gh(['api', `repos/${process.env.GH_REPO}/commits/${refName}`, '--jq', '.sha']);
  } catch (cause) {
    console.warn(
      `Could not read the tip of ${refName}, so a cancellation will be reported: ${cause.message}`,
    );
    return null;
  }
}

function readOpenWorkflowIssueNumbers(runGh = gh) {
  const found = runGh([
    'issue',
    'list',
    '--state',
    'open',
    '--label',
    ISSUE_LABEL,
    '--limit',
    '100',
    '--json',
    'number',
    '--jq',
    '.[].number',
  ]);
  return found.split('\n').filter(Boolean).map(Number).filter(Number.isInteger);
}

function commentOnIssue(issueNumber, body, runGh) {
  runGh(['issue', 'comment', String(issueNumber), '--body', body]);
}

function closeIssue(issueNumber, body, runGh) {
  commentOnIssue(issueNumber, body, runGh);
  runGh(['issue', 'close', String(issueNumber)]);
}

function reconcileOpenIssues(issueNumbers, canonicalNumber, runGh) {
  for (const issueNumber of issueNumbers) {
    if (issueNumber !== canonicalNumber) {
      closeIssue(
        issueNumber,
        `Closing this duplicate unattended workflow report in favor of #${canonicalNumber}. The issue remains available as failure history.`,
        runGh,
      );
    }
  }
}

/** Publishes one workflow decision and reconciles currently visible duplicate reports to one open canonical issue. */
export function publishOutcome({ decision, context, existingIssueNumbers, runGh = gh }) {
  if (decision.action === 'none') {
    console.log(`No report filed: ${decision.reason}.`);
    return;
  }

  if (decision.action === 'close') {
    for (const issueNumber of existingIssueNumbers) {
      closeIssue(
        issueNumber,
        `Closing: ${context.workflow} completed cleanly on ${context.headSha}.\n\nRun: ${context.runUrl}`,
        runGh,
      );
    }
    console.log(
      `Closed ${existingIssueNumbers.map((number) => `#${number}`).join(', ')}: ${decision.reason}.`,
    );
    return;
  }

  const body = buildBody({ decision, context });
  runGh([
    'label',
    'create',
    ISSUE_LABEL,
    '--color',
    'b60205',
    '--description',
    'An unattended workflow run failed or was cancelled',
    '--force',
  ]);

  if (decision.action === 'comment') {
    const [canonicalNumber, ...duplicates] = existingIssueNumbers.toSorted((a, b) => a - b);
    commentOnIssue(canonicalNumber, body, runGh);
    reconcileOpenIssues(duplicates, canonicalNumber, runGh);
    console.log(`Commented on #${canonicalNumber}: ${decision.reason}.`);
    return;
  }

  const createdUrl = runGh([
    'issue',
    'create',
    '--title',
    ISSUE_TITLE,
    '--label',
    ISSUE_LABEL,
    '--body',
    body,
  ]);
  const createdNumber = Number(/\/(\d+)\s*$/.exec(createdUrl)?.[1]);
  if (!Number.isInteger(createdNumber))
    throw new Error('GitHub did not return the created report issue number');

  // GitHub has no atomic label-keyed create. A competing run can create after our first list; reread
  // after publication, keep the oldest visible issue open, and retain duplicates as closed history.
  const visibleIssues = readOpenWorkflowIssueNumbers(runGh);
  const candidates = [...new Set([...visibleIssues, ...existingIssueNumbers, createdNumber])].sort(
    (a, b) => a - b,
  );
  const [canonicalNumber, ...duplicates] = candidates;
  if (createdNumber !== canonicalNumber) {
    commentOnIssue(
      canonicalNumber,
      `Another run reported this failure while reports were being reconciled:\n\n${body}`,
      runGh,
    );
  }
  reconcileOpenIssues(duplicates, canonicalNumber, runGh);
  console.log(`Opened or reconciled #${canonicalNumber}: ${decision.reason}.`);
}

function main() {
  const context = {
    workflow: process.env.GITHUB_WORKFLOW ?? 'unknown',
    eventName: process.env.GITHUB_EVENT_NAME ?? 'unknown',
    ref: process.env.GITHUB_REF ?? 'unknown',
    refName: process.env.GITHUB_REF_NAME ?? 'main',
    headSha: process.env.GITHUB_SHA ?? 'unknown',
    runUrl: process.env.RUN_URL ?? 'unknown',
  };
  const results = parseResults(process.env.RESULTS);
  if (results.length === 0) {
    console.error('No job results were passed in; refusing to guess whether the run was healthy.');
    process.exit(1);
  }

  const existingIssueNumbers = readOpenWorkflowIssueNumbers();
  const needsTip = results.some((entry) => entry.result === 'cancelled');
  const branchTip = needsTip ? readBranchTip(context) : null;
  const decision = decide({
    results,
    headSha: context.headSha,
    branchTip,
    existingIssue: existingIssueNumbers[0] ?? null,
  });
  publishOutcome({ decision, context, existingIssueNumbers });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
