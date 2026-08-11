import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SIGN_OFF_PATTERN = /^Signed-off-by:\s+(.+?)\s+<([^<>\s]+)>\s*$/gim;

function normalizedEmail(email) {
  return email.trim().toLowerCase();
}

export function isDcoExemptPullRequestAuthor(author) {
  return author === "dependabot[bot]";
}

export function isMergeCommit(parents) {
  return parents.trim().split(/\s+/).filter(Boolean).length > 1;
}

export function evaluateDcoCommit({ authorEmail, committerEmail, message }) {
  const permittedEmails = new Set([authorEmail, committerEmail].map(normalizedEmail));
  const signatories = [...message.matchAll(SIGN_OFF_PATTERN)]
    .map((match) => ({
      name: match[1].trim(),
      email: normalizedEmail(match[2]),
    }))
    .filter(({ name }) => name.length > 0);

  return {
    valid: signatories.some(({ email }) => permittedEmails.has(email)),
    signatories,
  };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}

export function verifyDcoRange(base, head, pullRequestAuthor) {
  if (isDcoExemptPullRequestAuthor(pullRequestAuthor)) {
    console.log("Dependabot commits are exempt from DCO sign-off.");
    return true;
  }

  const commits = git(["rev-list", `${base}..${head}`])
    .trim()
    .split("\n")
    .filter(Boolean);
  let valid = true;

  for (const commit of commits) {
    if (isMergeCommit(git(["show", "-s", "--format=%P", commit]))) {
      console.log(`Skipping generated merge commit ${commit}; its feature commits carry the DCO sign-offs.`);
      continue;
    }
    // Uppercase placeholders apply .mailmap, so contributors can use an established canonical
    // address without weakening the identity comparison.
    const [authorEmail, committerEmail, message] = git([
      "show",
      "-s",
      "--use-mailmap",
      "--format=%aE%x00%cE%x00%B",
      commit,
    ]).split("\0");
    const result = evaluateDcoCommit({ authorEmail, committerEmail, message });
    if (!result.valid) {
      console.error(`::error::Commit ${commit} needs a Signed-off-by trailer matching its author or committer email`);
      valid = false;
    }
  }

  return valid;
}

function main() {
  const [base, head, pullRequestAuthor = ""] = process.argv.slice(2);
  if (!base || !head) {
    console.error("Usage: node scripts/check-dco.mjs <base-sha> <head-sha> [pull-request-author]");
    process.exitCode = 2;
    return;
  }
  if (!verifyDcoRange(base, head, pullRequestAuthor)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
