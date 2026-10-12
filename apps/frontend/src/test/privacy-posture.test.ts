import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// Keep Node types local to these filesystem imports so browser application types
// do not gain Node globals.
import { cwd } from "node:process";

// Deny analytics, telemetry and vendor email SDK dependencies. Operator-configured
// SMTP is the allowed mail transport; native-fetch password screening and browser
// CSP have separate checks. Match exact package names to avoid false substring hits.

// Curated deny-known-bad list of analytics/telemetry + email packages. Keep it maintainable:
// add the egress-vendor SDKs people actually reach for, not every transitive utility.
const DENYLIST: string[] = [
  "segment",
  "@segment/analytics-node",
  "analytics-node",
  "analytics",
  "mixpanel",
  "mixpanel-browser",
  "mixpanel-node",
  "amplitude-js",
  "@amplitude/analytics-browser",
  "@amplitude/analytics-node",
  "posthog-js",
  "posthog-node",
  "heap-api",
  "fullstory",
  "@fullstory/browser",
  "react-ga",
  "react-ga4",
  "ga-gtag",
  "@sentry/browser",
  "@sentry/node",
  "@sentry/react",
  "bugsnag",
  "@bugsnag/js",
  "dd-trace",
  "@datadog/browser-rum",
  "newrelic",
  "rollbar",
  "logrocket",

  "@sendgrid/mail",
  "@sendgrid/client",
  "sendgrid",
  "mailgun",
  "mailgun-js",
  "mailgun.js",
  "postmark",
  "@aws-sdk/client-ses",
  "aws-ses",
  "node-ses",
  "resend",
  "@mailchimp/mailchimp_marketing",
  "mandrill-api",
  "emailjs",
];

const DENYSET = new Set(DENYLIST);

const REPO_ROOT = resolve(cwd(), "../..");

interface Manifest {
  name: string;
  /** Combined dependency-name keys from `dependencies` + `devDependencies`. */
  deps: string[];
}

// Surface missing or malformed manifests so dependency checks cannot pass vacuously.
function readManifest(relPath: string): Manifest {
  const raw = readFileSync(join(REPO_ROOT, relPath), "utf8");
  const json: unknown = JSON.parse(raw);
  if (typeof json !== "object" || json === null) {
    throw new Error(`${relPath} did not parse to an object`);
  }
  const pkg = json as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  return { name: relPath, deps };
}

const MANIFEST_PATHS = [
  "package.json",
  "apps/frontend/package.json",
  "apps/backend/package.json",
  "packages/shared/package.json",
  "server/package.json",
];

describe("P2.7 privacy posture — no analytics/telemetry/email vendor dependency", () => {
  const manifests = MANIFEST_PATHS.map(readManifest);

  // Non-vacuous guard: a path/parse mistake that yielded empty dep sets would make every
  // "not in denylist" assertion trivially pass. Prove we actually read real dependency data.
  it("reads real dependency data from all current manifests (non-vacuous)", () => {
    expect(manifests).toHaveLength(MANIFEST_PATHS.length);
    for (const m of manifests) {
      expect(Array.isArray(m.deps)).toBe(true);
      expect(m.deps.length).toBeGreaterThan(0);
    }
  });

  it("allows the SMTP transport only in backend manifests and retains the legacy server dependency", () => {
    for (const manifest of manifests) {
      if (manifest.deps.includes("nodemailer")) {
        expect(["apps/backend/package.json", "server/package.json"], manifest.name).toContain(manifest.name);
      }
    }

    expect(manifests.find((manifest) => manifest.name === "server/package.json")?.deps).toContain("nodemailer");
  });

  it.each(MANIFEST_PATHS)("%s declares no denylisted dependency", (relPath) => {
    const manifest = manifests.find((m) => m.name === relPath);
    if (manifest === undefined) throw new Error(`Missing manifest fixture for ${relPath}`);
    for (const dep of manifest.deps) {
      expect(DENYSET.has(dep), `${relPath} declares denylisted dependency "${dep}"`).toBe(false);
    }
  });

  // Transitive backstop: a denylisted vendor pulled in indirectly (not declared in any manifest)
  // is just as much an egress risk, so scan the resolved lockfile too.
  it("the resolved lockfile installs no denylisted package (transitive backstop)", () => {
    const raw = readFileSync(join(REPO_ROOT, "pnpm-lock.yaml"), "utf8");

    const installed = new Set<string>();

    // Parse each lockfile package name independently of its specifier so registry, git,
    // tarball and local dependencies receive the same denylist check.
    const keyLine = /^ {2}'?((?:@[^\s/']+\/)?[^\s@']+)@(?:\d|https?:|git\+|file:|link:)/;
    for (const line of raw.split("\n")) {
      const match = keyLine.exec(line);
      const packageName = match?.[1];
      if (packageName !== undefined) installed.add(packageName);
    }

    // Non-vacuous: we must have parsed a real tree. (A lockfile format change that stops these
    // lines matching must fail here, loudly, not silently scan nothing and vacuously pass.)
    expect(installed.size).toBeGreaterThan(100);

    const offenders = [...installed].filter((name) => DENYSET.has(name));
    expect(offenders, `lockfile installs denylisted package(s): ${offenders.join(", ")}`).toEqual([]);
  });
});
