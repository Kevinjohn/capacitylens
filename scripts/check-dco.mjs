import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SIGN_OFF_PATTERN = /^Signed-off-by:\s+(.+?)\s+<([^<>\s]+)>\s*$/gim;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const EMAIL_PATTERN = /^[^<>\s@]+@[^<>\s@]+$/;
const RATIFICATIONS_URL = new URL("./dco-ratifications.json", import.meta.url);

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

export function validateDcoRatifications(ratifications) {
  if (!ratifications || typeof ratifications !== "object" || Array.isArray(ratifications)) {
    throw new TypeError("DCO ratifications must be an object keyed by full commit SHA");
  }

  for (const [commit, ratification] of Object.entries(ratifications)) {
    if (
      !COMMIT_SHA_PATTERN.test(commit) ||
      !ratification ||
      typeof ratification !== "object" ||
      Array.isArray(ratification) ||
      !EMAIL_PATTERN.test(ratification.ratifierEmail ?? "") ||
      !COMMIT_SHA_PATTERN.test(ratification.attestationCommit ?? "")
    ) {
      throw new TypeError(
        "Each DCO ratification must name a ratifier email and the full lowercase SHA of its attestation commit",
      );
    }
  }

  return ratifications;
}

export function evaluateDcoRatification(target, ratification, attestation) {
  const ratifierEmail = normalizedEmail(ratification.ratifierEmail);
  const targetEmails = [target.authorEmail, target.committerEmail].map(normalizedEmail);
  const attestationEmails = [attestation.authorEmail, attestation.committerEmail].map(normalizedEmail);

  return (
    targetEmails.includes(ratifierEmail) &&
    attestationEmails.includes(ratifierEmail) &&
    evaluateDcoCommit(attestation).valid &&
    new RegExp(`^\\+\\s*"${target.commit}"\\s*:`, "m").test(attestation.patch)
  );
}

function loadDcoRatifications() {
  return validateDcoRatifications(JSON.parse(readFileSync(RATIFICATIONS_URL, "utf8")));
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}

function isAncestor(commit, head) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, head], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isDcoRatifiedCommit(target, ratifications, head) {
  if (!Object.hasOwn(ratifications, target.commit)) return false;

  const ratification = ratifications[target.commit];
  if (!isAncestor(ratification.attestationCommit, head)) return false;

  const [authorEmail, committerEmail, message, patch] = git([
    "show",
    "--use-mailmap",
    "--format=%aE%x00%cE%x00%B%x00",
    "--patch",
    ratification.attestationCommit,
    "--",
    "scripts/dco-ratifications.json",
  ]).split("\0");

  return evaluateDcoRatification(target, ratification, { authorEmail, committerEmail, message, patch });
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
  const ratifications = loadDcoRatifications();
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
    if (!result.valid && isDcoRatifiedCommit({ commit, authorEmail, committerEmail }, ratifications, head)) {
      console.log(`Accepting ratified DCO commit ${commit}.`);
    } else if (!result.valid) {
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
