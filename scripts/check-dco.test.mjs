import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDcoCommit,
  isDcoExemptPullRequestAuthor,
  isDcoRatifiedCommit,
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
  const ratifications = {
    "0123456789abcdef0123456789abcdef01234567": "AUTHOR@example.com",
  };
  const details = {
    commit: "0123456789abcdef0123456789abcdef01234567",
    authorEmail: "author@example.com",
    committerEmail: "committer@example.com",
  };

  assert.equal(isDcoRatifiedCommit(details, ratifications), true);
  assert.equal(
    isDcoRatifiedCommit({ ...details, commit: "1123456789abcdef0123456789abcdef01234567" }, ratifications),
    false,
  );
  assert.equal(
    isDcoRatifiedCommit(details, {
      "0123456789abcdef0123456789abcdef01234567": "unrelated@example.com",
    }),
    false,
  );
});

test("accepts a ratification from the commit committer", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(
    isDcoRatifiedCommit(
      { commit: sha, authorEmail: "author@example.com", committerEmail: "committer@example.com" },
      { [sha]: "COMMITTER@example.com" },
    ),
    true,
  );
});

test("rejects malformed DCO ratification ledgers", () => {
  for (const ratifications of [
    null,
    [],
    { shortsha: "author@example.com" },
    { "0123456789abcdef0123456789abcdef01234567": "" },
    { "0123456789abcdef0123456789abcdef01234567": 42 },
  ]) {
    assert.throws(() => validateDcoRatifications(ratifications), TypeError);
  }
});
