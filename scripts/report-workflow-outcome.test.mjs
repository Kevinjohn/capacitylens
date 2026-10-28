import { readFileSync } from "node:fs";
import YAML from "yaml";
import test from "node:test";
import assert from "node:assert/strict";

import { buildBody, decide, parseResults, publishOutcome } from "./report-workflow-outcome.mjs";

const TIP = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLDER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const results = (entries) => Object.entries(entries).map(([job, result]) => ({ job, result }));
const context = (run, job = "secrets") => ({
  workflow: "security",
  eventName: "schedule",
  ref: "refs/heads/main",
  headSha: TIP,
  runUrl: `https://github.com/o/r/actions/runs/${run}`,
  run,
  job,
});

function githubIssues(initial = [], listOverrides = []) {
  let nextNumber = initial.reduce((maximum, issue) => Math.max(maximum, issue.number), 0) + 1;
  const issues = new Map(initial.map((issue) => [issue.number, { ...issue, comments: [] }]));
  const calls = [];
  const runGh = (args) => {
    calls.push(args);
    if (args[0] === "label") return "";
    if (args[0] === "issue" && args[1] === "list") {
      if (listOverrides.length > 0) return listOverrides.shift().join("\n");
      return [...issues.values()]
        .filter((issue) => issue.open)
        .map((issue) => String(issue.number))
        .join("\n");
    }
    if (args[0] === "issue" && args[1] === "create") {
      const issue = { number: nextNumber++, open: true, body: args.at(-1), comments: [] };
      issues.set(issue.number, issue);
      return `https://github.com/o/r/issues/${issue.number}`;
    }
    if (args[0] === "issue" && args[1] === "comment") {
      issues.get(Number(args[2])).comments.push(args.at(-1));
      return "";
    }
    if (args[0] === "issue" && args[1] === "close") {
      issues.get(Number(args[2])).open = false;
      return "";
    }
    throw new Error(`Unexpected gh invocation: ${args.join(" ")}`);
  };
  return { issues, calls, runGh };
}

test("a clean run files nothing when no report is open", () => {
  const decision = decide({
    results: results({ secrets: "success", sbom: "success", dast: "skipped" }),
    headSha: TIP,
    branchTip: TIP,
    existingIssue: null,
  });
  assert.equal(decision.action, "none");
});

test("a clean run closes an open report, so a transient failure tidies up after itself", () => {
  const decision = decide({
    results: results({ secrets: "success", sbom: "skipped" }),
    headSha: TIP,
    branchTip: TIP,
    existingIssue: "42",
  });
  assert.equal(decision.action, "close");
});

test("a failure opens a report naming only the jobs that broke", () => {
  const decision = decide({
    results: results({ secrets: "failure", sbom: "success", containers: "failure", dast: "skipped" }),
    headSha: TIP,
    branchTip: TIP,
    existingIssue: null,
  });
  assert.equal(decision.action, "open");
  assert.deepEqual(decision.jobs, ["secrets", "containers"]);
});

test("a repeat failure comments rather than filing a duplicate", () => {
  const decision = decide({
    results: results({ secrets: "failure" }),
    headSha: TIP,
    branchTip: TIP,
    existingIssue: "42",
  });
  assert.equal(decision.action, "comment");
});

test("a run cancelled by a newer push is silent, because that is cancel-in-progress working", () => {
  const decision = decide({
    results: results({ secrets: "cancelled", sbom: "cancelled" }),
    headSha: OLDER,
    branchTip: TIP,
    existingIssue: null,
  });
  assert.equal(decision.action, "none");
  assert.match(decision.reason, /newer push/);
});

test("a run cancelled while still the branch tip is reported: nothing else would surface it", () => {
  const decision = decide({
    results: results({ secrets: "success", sbom: "cancelled", containers: "cancelled" }),
    headSha: TIP,
    branchTip: TIP,
    existingIssue: null,
  });
  assert.equal(decision.action, "open");
  assert.deepEqual(decision.jobs, ["sbom", "containers"]);
});

test("an unreadable branch tip reports rather than assuming a supersede", () => {
  // The API call that reads the tip can fail during the very outage this report exists to surface,
  // so "unknown" must fail loud.
  const decision = decide({
    results: results({ sbom: "cancelled" }),
    headSha: TIP,
    branchTip: null,
    existingIssue: null,
  });
  assert.equal(decision.action, "open");
});

test("a genuine failure is reported even on a superseded commit", () => {
  // A newer push explains a cancellation. It does not explain a job that ran and failed.
  const decision = decide({
    results: results({ secrets: "failure", sbom: "cancelled" }),
    headSha: OLDER,
    branchTip: TIP,
    existingIssue: null,
  });
  assert.equal(decision.action, "open");
  assert.deepEqual(decision.jobs, ["secrets"]);
});

test("skipped jobs alone are not a failure", () => {
  const decision = decide({
    results: results({ "dependency-review": "skipped", "release-provenance": "skipped" }),
    headSha: TIP,
    branchTip: TIP,
    existingIssue: null,
  });
  assert.equal(decision.action, "none");
});

test("results parse from the workflow's plain-text job list", () => {
  assert.deepEqual(parseResults("secrets=failure\n  sbom=success  \n\n"), [
    { job: "secrets", result: "failure" },
    { job: "sbom", result: "success" },
  ]);
  assert.deepEqual(parseResults(undefined), []);
});

test("the body links the run and says so when no job accounts for the failure", () => {
  const body = buildBody({
    decision: { action: "open", jobs: [], reason: "the workflow failed" },
    context: {
      workflow: "security",
      eventName: "schedule",
      ref: "refs/heads/main",
      headSha: TIP,
      runUrl: "https://github.com/o/r/actions/runs/1",
    },
  });
  assert.match(body, /https:\/\/github\.com\/o\/r\/actions\/runs\/1/);
  assert.match(body, /none reported/);
  assert.match(body, /closes itself/);
});

test("overlapping first failures converge after stale initial lists while retaining both runs' evidence", () => {
  const github = githubIssues([], [[1], [2]]);
  const failureA = { action: "open", jobs: ["secrets"], reason: "the workflow failed" };
  const failureB = { action: "open", jobs: ["sbom"], reason: "the workflow failed" };

  // Both runners decided to open from the same empty initial list. Their post-create issue-list
  // reads are each stale and show only their own report, leaving two open issues temporarily.
  publishOutcome({ decision: failureA, context: context(101), existingIssueNumbers: [], runGh: github.runGh });
  publishOutcome({ decision: failureB, context: context(102), existingIssueNumbers: [], runGh: github.runGh });
  assert.deepEqual(
    [...github.issues.values()].filter((issue) => issue.open).map(({ number }) => number),
    [1, 2],
  );

  // The next scheduled/push run sees both, comments on the oldest, and closes the duplicate.
  publishOutcome({
    decision: { action: "comment", jobs: ["secrets"], reason: "the workflow failed" },
    context: context(103),
    existingIssueNumbers: [1, 2],
    runGh: github.runGh,
  });

  const openIssues = [...github.issues.values()].filter((issue) => issue.open);
  assert.deepEqual(
    openIssues.map(({ number }) => number),
    [1],
  );
  assert.match(openIssues[0].body, /runs\/101/);
  assert.match(openIssues[0].comments.join("\n"), /runs\/103/);
  assert.equal(github.issues.get(2).open, false);
  assert.match(github.issues.get(2).body, /runs\/102/);
  assert.match(github.issues.get(2).body, /sbom/);
});

test("a repeat failure comments on the oldest open report and closes visible duplicates", () => {
  const github = githubIssues([
    { number: 41, open: true, body: "first failure history" },
    { number: 42, open: true, body: "second failure history" },
  ]);
  publishOutcome({
    decision: { action: "comment", jobs: ["secrets"], reason: "the workflow failed" },
    context: context(103),
    existingIssueNumbers: [42, 41],
    runGh: github.runGh,
  });

  assert.equal(github.issues.get(41).open, true);
  assert.match(github.issues.get(41).comments.join("\n"), /runs\/103/);
  assert.equal(github.issues.get(42).open, false);
  assert.match(github.issues.get(42).comments.join("\n"), /in favor of #41/);
});

test("security reporter includes every upstream job outcome", () => {
  const workflow = YAML.parse(readFileSync(new URL("../.github/workflows/security.yml", import.meta.url), "utf8"));
  const notify = workflow.jobs.notify;
  const mapping = notify.steps.find((step) => step.env?.RESULTS)?.env.RESULTS;
  assert.ok(notify.needs.includes("dependency-review"));
  for (const job of notify.needs) assert.ok(mapping.includes(`${job}=\${{ needs.${job}.result }}`), job);
});
