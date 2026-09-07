import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDcoCommit,
  evaluateDcoRatification,
  isDcoExemptPullRequestAuthor,
  isMergeCommit,
  validateDcoRatifications,
} from "./check-dco.mjs";

const commit = (message, overrides = {}) => ({
  authorEmail: "author@example.com",
  committerEmail: "committer@example.com",
  message,
  ...overrides,
});

test("accepts a sign-off from the commit author", () => {
  assert.equal(evaluateDcoCommit(commit("Change\n\nSigned-off-by: Author <AUTHOR@example.com>\n")).valid, true);
});

test("accepts a sign-off from the committer", () => {
  assert.equal(evaluateDcoCommit(commit("Change\n\nSigned-off-by: Committer <committer@example.com>\n")).valid, true);
});

test("rejects a sign-off from an unrelated identity", () => {
  assert.equal(evaluateDcoCommit(commit("Change\n\nSigned-off-by: Other <other@example.com>\n")).valid, false);
});

test("rejects malformed and missing trailers", () => {
  for (const message of [
    "Change",
    "Change\n\nSigned-off-by: Author author@example.com",
    "Change\n\nSigned-off-by: <> ",
    "Change\n\nSigned-off-by:   <author@example.com>",
  ]) {
    assert.equal(evaluateDcoCommit(commit(message)).valid, false);
  }
});

test("accepts one matching trailer among multiple contributors", () => {
  const message = [
    "Change",
    "",
    "Signed-off-by: Other <other@example.com>",
    "Signed-off-by: Author <author@example.com>",
  ].join("\n");
  assert.equal(evaluateDcoCommit(commit(message)).valid, true);
});

test("exempts only Dependabot pull requests", () => {
  assert.equal(isDcoExemptPullRequestAuthor("dependabot[bot]"), true);
  assert.equal(isDcoExemptPullRequestAuthor("renovate[bot]"), false);
  assert.equal(isDcoExemptPullRequestAuthor("contributor"), false);
});

test("identifies generated merge commits by their multiple parents", () => {
  assert.equal(isMergeCommit(""), false);
  assert.equal(isMergeCommit("parent-one"), false);
  assert.equal(isMergeCommit("parent-one parent-two"), true);
  assert.equal(isMergeCommit("parent-one parent-two parent-three\n"), true);
});

test("accepts only an exact ratification from the commit author or committer", () => {
  const details = {
    commit: "0123456789abcdef0123456789abcdef01234567",
    authorEmail: "author@example.com",
    committerEmail: "committer@example.com",
  };
  const ratification = {
    ratifierEmail: "AUTHOR@example.com",
    attestationCommit: "abcdef0123456789abcdef0123456789abcdef01",
  };
  const attestation = {
    authorEmail: "author@example.com",
    committerEmail: "committer@example.com",
    message: "Ratify\n\nSigned-off-by: Author <author@example.com>",
    patch: `+  "${details.commit}": {}`,
  };

  assert.equal(evaluateDcoRatification(details, ratification, attestation), true);
  assert.equal(
    evaluateDcoRatification(
      { ...details, commit: "1123456789abcdef0123456789abcdef01234567" },
      ratification,
      attestation,
    ),
    false,
  );
  assert.equal(
    evaluateDcoRatification(details, { ...ratification, ratifierEmail: "unrelated@example.com" }, attestation),
    false,
  );
  assert.equal(evaluateDcoRatification(details, ratification, { ...attestation, patch: `-${details.commit}` }), false);
});

test("requires the ratifier to sign the attestation commit", () => {
  const target = {
    commit: "0123456789abcdef0123456789abcdef01234567",
    authorEmail: "author@example.com",
    committerEmail: "committer@example.com",
  };
  const ratification = {
    ratifierEmail: "author@example.com",
    attestationCommit: "abcdef0123456789abcdef0123456789abcdef01",
  };
  const attestation = {
    authorEmail: "other@example.com",
    committerEmail: "other@example.com",
    message: "Ratify\n\nSigned-off-by: Other <other@example.com>",
    patch: `+${target.commit}`,
  };

  assert.equal(evaluateDcoRatification(target, ratification, attestation), false);
});

test("rejects malformed DCO ratification ledgers", () => {
  for (const ratifications of [
    null,
    [],
    { shortsha: { ratifierEmail: "author@example.com", attestationCommit: "a".repeat(40) } },
    { ["0".repeat(40)]: { ratifierEmail: "not-an-email", attestationCommit: "a".repeat(40) } },
    { ["0".repeat(40)]: { ratifierEmail: "author@example.com", attestationCommit: "shortsha" } },
  ]) {
    assert.throws(() => validateDcoRatifications(ratifications), TypeError);
  }
});
