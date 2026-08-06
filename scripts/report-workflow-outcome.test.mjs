// The cases that make unattended-failure reporting worth having, and the ones that make it
// annoying enough to be switched off. Both are worth pinning.

import test from "node:test";
import assert from "node:assert/strict";

import { buildBody, decide, parseResults } from "./report-workflow-outcome.mjs";

const TIP = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLDER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const results = (entries) => Object.entries(entries).map(([job, result]) => ({ job, result }));

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
