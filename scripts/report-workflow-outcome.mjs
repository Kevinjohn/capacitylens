// Reports an unattended workflow outcome as a GitHub issue, and closes that issue once the
// workflow is healthy again.
//
// A failure on a pull request is already in front of the person who caused it. A failure on a
// schedule or on `main` is in front of nobody: no pull request turns red, no reviewer is waiting.
// The weekly security scan broke on 2026-08-04 and stayed red for two days on exactly that gap.
//
// Three judgements make this harder than "if it failed, file an issue", and all three live in
// `decide` below so they can be tested without GitHub:
//
// 1. A cancelled run is not automatically a problem. The security workflow sets
//    `cancel-in-progress: true`, so pushing twice in quick succession cancels the first run by
//    design. That is healthy and must stay silent. But a run cancelled while it is still the tip
//    of its branch was cancelled by something else — a runner outage, a queue timeout, someone
//    hitting the button — and that is the failure mode most likely to go unnoticed, because it
//    produces no logs to read. The discriminator is therefore whether the commit is still the
//    branch tip, not the cancellation itself.
//
// 2. Reporting must not cry wolf. An issue filed for every transient runner hiccup trains a
//    reader to ignore the label, which is how the previous secret-scanning exception list decayed.
//    So a green run closes the open report rather than leaving it for someone to tidy up: a
//    transient failure that fixes itself on the next run closes itself too, and an issue that
//    stays open means something that is still broken.
//
// 3. One report, not a pile. A repeat failure comments on the open issue instead of filing a
//    duplicate, so the history of a recurring problem stays in one place.
//
// Scope: this decides and reports. It cannot prove the workflow reaches it during a hard
// cancellation — GitHub gives remaining jobs only a short grace window once a run is cancelled,
// and that is a property of the platform, not of this file.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ISSUE_LABEL = "security-scan-failure";
export const ISSUE_TITLE = "Security workflow is failing";

// Decides what to do about a run, given its job results and the state of the branch it ran on.
// Pure by design: every input is a value, so the awkward cases are testable.
export function decide({ results, headSha, branchTip, existingIssue }) {
  const failed = results.filter((entry) => entry.result === "failure");
  const cancelled = results.filter((entry) => entry.result === "cancelled");

  // "skipped" is not a problem — most jobs here are conditional on the event.
  if (failed.length === 0 && cancelled.length === 0) {
    return existingIssue
      ? { action: "close", jobs: [], reason: "the workflow is healthy again" }
      : { action: "none", jobs: [], reason: "the workflow succeeded and no report is open" };
  }

  // A cancellation on a commit that is no longer the branch tip is `cancel-in-progress` doing its
  // job. Only stay silent when the newer commit is known: if the tip could not be read, report
  // rather than assume, because a missed outage costs more than a redundant issue.
  if (failed.length === 0 && branchTip && branchTip !== headSha) {
    return {
      action: "none",
      jobs: [],
      reason: `cancelled by a newer push (${branchTip.slice(0, 7)}), which is not a failure`,
    };
  }

  const jobs = failed.length > 0 ? failed : cancelled;
  const kind = failed.length > 0 ? "failed" : "was cancelled without completing";
  return {
    action: existingIssue ? "comment" : "open",
    jobs: jobs.map((entry) => entry.job),
    reason: `the workflow ${kind}`,
  };
}

// Parses the `job=result` lines the workflow passes in. Written as text rather than JSON because
// it is assembled from `needs.*.result` expressions in YAML, where quoting JSON is a trap.
export function parseResults(raw) {
  return (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      return { job: line.slice(0, separator), result: line.slice(separator + 1) };
    })
    .filter((entry) => entry.job && entry.result);
}

export function buildBody({ decision, context }) {
  const lines = [
    `The \`${context.workflow}\` workflow ${decision.reason}, on a run nobody is watching.`,
    "",
    `- Trigger: \`${context.eventName}\` on \`${context.ref}\``,
    `- Commit: ${context.headSha}`,
    `- Jobs: ${decision.jobs.length > 0 ? decision.jobs.join(", ") : "none reported — the run failed outside the jobs this check covers"}`,
    `- Run: ${context.runUrl}`,
    "",
    "This issue closes itself when the workflow next completes cleanly, so an open report means something still needs attention.",
  ];
  return lines.join("\n");
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

// Reading the branch tip is best-effort: the API call can fail during the very outage this report
// exists to surface. A null tip means "unknown", which `decide` treats as "report it".
function readBranchTip({ refName, eventName }) {
  // Only a branch can be superseded by a newer push. A tag always resolves to its own commit.
  if (eventName !== "push" && eventName !== "schedule") return null;
  try {
    return gh(["api", `repos/${process.env.GH_REPO}/commits/${refName}`, "--jq", ".sha"]);
  } catch (cause) {
    console.warn(`Could not read the tip of ${refName}, so a cancellation will be reported: ${cause.message}`);
    return null;
  }
}

function findOpenIssue() {
  const found = gh([
    "issue",
    "list",
    "--state",
    "open",
    "--label",
    ISSUE_LABEL,
    "--limit",
    "1",
    "--json",
    "number",
    "--jq",
    ".[0].number // empty",
  ]);
  return found === "" ? null : found;
}

function main() {
  const context = {
    workflow: process.env.GITHUB_WORKFLOW ?? "unknown",
    eventName: process.env.GITHUB_EVENT_NAME ?? "unknown",
    ref: process.env.GITHUB_REF ?? "unknown",
    refName: process.env.GITHUB_REF_NAME ?? "main",
    headSha: process.env.GITHUB_SHA ?? "unknown",
    runUrl: process.env.RUN_URL ?? "unknown",
  };
  const results = parseResults(process.env.RESULTS);
  if (results.length === 0) {
    console.error("No job results were passed in; refusing to guess whether the run was healthy.");
    process.exit(1);
  }

  const existingIssue = findOpenIssue();
  const needsTip = results.some((entry) => entry.result === "cancelled");
  const branchTip = needsTip ? readBranchTip(context) : null;
  const decision = decide({ results, headSha: context.headSha, branchTip, existingIssue });

  if (decision.action === "none") {
    console.log(`No report filed: ${decision.reason}.`);
    return;
  }

  if (decision.action === "close") {
    gh([
      "issue",
      "comment",
      existingIssue,
      "--body",
      `Closing: ${context.workflow} completed cleanly on ${context.headSha}.\n\nRun: ${context.runUrl}`,
    ]);
    gh(["issue", "close", existingIssue]);
    console.log(`Closed #${existingIssue}: ${decision.reason}.`);
    return;
  }

  const body = buildBody({ decision, context });
  // The label doubles as the deduplication key, so it has to exist before anything is filed.
  gh([
    "label",
    "create",
    ISSUE_LABEL,
    "--color",
    "b60205",
    "--description",
    "An unattended workflow run failed or was cancelled",
    "--force",
  ]);

  if (decision.action === "comment") {
    gh(["issue", "comment", existingIssue, "--body", body]);
    console.log(`Commented on #${existingIssue}: ${decision.reason}.`);
    return;
  }

  gh(["issue", "create", "--title", ISSUE_TITLE, "--label", ISSUE_LABEL, "--body", body]);
  console.log(`Opened a report: ${decision.reason}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
