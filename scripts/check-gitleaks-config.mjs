// Validates .gitleaks.toml, the secret scanner's reviewed fixture allowlist.
//
// The allowlist fails open by nature: a mistake in it makes the scan report fewer secrets, and a
// scan reporting nothing looks exactly like a scan finding nothing. Two failure modes are real
// enough to guard mechanically.
//
// The first is a `paths` allowlist. Gitleaks applies those at file level and skips the file before
// scanning it, so a `paths` entry intended to narrow a value pattern to test code instead disables
// detection across every file it matches — silently, while still reporting "no leaks found". An
// earlier revision of the config made exactly that mistake; only the scanner's byte counter
// (0 bytes read instead of 582) gave it away.
//
// The second is a misspelled global table. Gitleaks 8.24 reads `[allowlist]`; Viper silently ignores
// the unsupported plural `[[allowlists]]`, leaving every reviewed fixture reportable even though
// this JavaScript checker can still see and compile the nested regex strings.
//
// The third is an over-broad value pattern. `[a-z-]*test-secret-…` looks precise but matches
// "latest-secret-…", because "la" + "test" satisfies it. Patterns must therefore break on segment
// boundaries, and the corpora below lock that in.
//
// Scope: this checks the allowlist's shape and its patterns' classification behaviour. It does not
// run gitleaks — the gate job has no gitleaks binary — so it cannot prove the scanner loads this
// file. The security workflow proves that, by passing with no .gitleaksignore present to fall back
// on. Note also that gitleaks compiles these patterns with Go's RE2 while this check uses
// JavaScript's engine; the patterns here are plain character classes and alternations, which both
// engines read identically, but anything exotic added later would need a real gitleaks run.

import { readFileSync } from "node:fs";

const configPath = ".gitleaks.toml";
const raw = readFileSync(configPath, "utf8");
const failures = [];

// Values that are fake by construction. Each must be allowlisted, or the scan goes red on a value
// already reviewed and the fingerprint treadmill starts over.
const fixtures = [
  "idempotency-1",
  "idempotency-2",
  "wrong-idempotency-1",
  "valid-idempotency-key-0001",
  "correlation-test-secret-0123456789abcdef",
  "crash-fixture-secret-0123456789abcdef",
  "fixture-secret-0123456789abcdef-012345",
  "capacitylens-oidc-e2e-secret-0123456789abcdef",
  "capacitylens-auth-e2e-secret-0123456789abcdef",
  "auth-e2e-bootstrap-token-0123456789abcdef",
];

// This file is scanned like any other, so a credential-shaped literal here is a finding here — the
// first version of it turned the gate red on its own test data, and GitHub's push protection
// rejected a provider-shaped key outright. Both are the scanners doing their job. The corpus below
// therefore assembles its high-entropy values at runtime from fragments too short to trip the
// entropy rules, and holds no provider-shaped keys ("sk_live_…", "ghp_…", "AKIA…") at all. Keep it
// that way when adding cases: the value the scanner must catch has to exist only in memory.
const entropy = (...fragments) => fragments.join("");
const randomLooking = entropy("Xk92mQpL", "zR7vT4nB", "8wYcJ3fH", "6sD1gA5e");
const alsoRandomLooking = entropy("Zq4vN8xR", "2mK7pL5t", "W9yB3cF6", "hJ1sD0gA");

// Values that must stay reportable: an ordinary high-entropy credential, then near-misses of the
// fixture patterns that exist to catch a pattern loosened past its intent.
const credentials = [
  randomLooking,
  // "latest" ends in "test": a pattern anchored on characters rather than segments allowlists this.
  "latest-secret-0123456789abcdef",
  // A fixture prefix does not make the rest of a value fake.
  `fixture-secret-${alsoRandomLooking}`,
  // Trailing material past the counter means this is not the counter-style key it imitates.
  `idempotency-1-${randomLooking}`,
];

// Track the current TOML table so `paths` is judged only where it would do harm.
let inAllowlist = false;
let globalAllowlistCount = 0;
for (const line of raw.split("\n")) {
  const text = line.includes("'''") ? line : line.replace(/#.*$/, "");
  const header = text.match(/^\s*\[{1,2}([^\]]+)\]{1,2}\s*$/);
  if (header) {
    const table = header[1].trim();
    if (table === "allowlists") {
      failures.push(
        "`[[allowlists]]` is not a supported global Gitleaks 8.24 table; use the singular `[allowlist]` table.",
      );
    }
    inAllowlist = table === "allowlist";
    if (inAllowlist) globalAllowlistCount += 1;
    continue;
  }
  if (inAllowlist && /^\s*paths\s*=/.test(text)) {
    failures.push(
      "`paths` is set inside an [[allowlists]] block. Gitleaks skips matching files before " +
        "scanning them, so this stops reporting every secret in those files, not just the " +
        "allowlisted values. Scope by value pattern instead.",
    );
  }
}

if (globalAllowlistCount !== 1) {
  failures.push(`Expected exactly one global [allowlist] table, found ${globalAllowlistCount}.`);
}

if (!/^\s*useDefault\s*=\s*true\s*$/m.test(raw)) {
  failures.push("[extend] useDefault must be true; without it the default rule set is discarded.");
}

// Patterns are written as TOML literal strings so backslashes survive; collect them in order.
const patterns = [...raw.matchAll(/'''([\s\S]*?)'''/g)].map((match) => match[1]);
if (patterns.length === 0) {
  failures.push("No allowlist patterns found — the config parses but allowlists nothing.");
}

const compiled = [];
for (const pattern of patterns) {
  try {
    compiled.push(new RegExp(pattern));
  } catch (cause) {
    failures.push(`Pattern does not compile: ${pattern} (${cause.message})`);
  }
}

if (compiled.length === patterns.length) {
  for (const value of fixtures) {
    if (!compiled.some((expression) => expression.test(value))) {
      failures.push(`Reviewed fixture value is no longer allowlisted, so the scan will fail on it: ${value}`);
    }
  }
  for (const value of credentials) {
    const matched = compiled.find((expression) => expression.test(value));
    if (matched) {
      failures.push(`A credential-shaped value is allowlisted by ${matched.source} and would go unreported: ${value}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`${configPath} is unsafe:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

console.log(
  `Gitleaks allowlist: ${patterns.length} patterns cover ${fixtures.length} reviewed fixtures and ` +
    `leave ${credentials.length} credential-shaped values reportable.`,
);
