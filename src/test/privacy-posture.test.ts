import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// The app tsconfig (`tsconfig.app.json`) carries only `vite/client` types, not `@types/node`, to keep
// the browser bundle's type surface honest. This is the ONE src test that reads files off disk (the
// dependency-denylist scan below). The node `fs`/`path`/`process` types it needs arrive through these
// `node:*` MODULE imports, which resolve file-scoped — they do NOT add node globals to the whole app
// project the way a `/// <reference types="node" />` triple-slash directive would. So we import `cwd`
// rather than reaching for the global `process.cwd()`.
import { cwd } from 'node:process'

// P2.7 privacy posture — the DEPENDENCY half of the no-egress proof.
//
// CapacityLens is privacy-first: it phones home to no one. The CSP half of the proof
// (server/src/app.helmet.test.ts) keeps the browser policy-bound to same-origin requests; THIS
// half guards the supply chain. If an analytics, telemetry, or email package is ever added to any
// workspace manifest — or pulled in transitively via the root lockfile — this test FAILS LOUDLY,
// naming the offending package and where it appeared, so the "we send nothing out" claim can't
// quietly rot as the dependency tree grows. See docs/privacy.md.
//
// Matching is EXACT package name only (no substring matching), so a legitimately-named package
// (e.g. some hypothetical "react-analytics-table" UI helper) can't be killed by a denylist entry
// it merely contains — we deny KNOWN-BAD names, precisely.

// Curated deny-known-bad list of analytics/telemetry + email packages. Keep it maintainable:
// add the egress-vendor SDKs people actually reach for, not every transitive utility.
const DENYLIST: string[] = [
  // --- analytics / telemetry / product phone-home / crash+APM reporting ---
  'segment',
  '@segment/analytics-node',
  'analytics-node',
  'analytics',
  'mixpanel',
  'mixpanel-browser',
  'mixpanel-node',
  'amplitude-js',
  '@amplitude/analytics-browser',
  '@amplitude/analytics-node',
  'posthog-js',
  'posthog-node',
  'heap-api',
  'fullstory',
  '@fullstory/browser',
  'react-ga',
  'react-ga4',
  'ga-gtag',
  '@sentry/browser',
  '@sentry/node',
  '@sentry/react',
  'bugsnag',
  '@bugsnag/js',
  'dd-trace',
  '@datadog/browser-rum',
  'newrelic',
  'rollbar',
  'logrocket',

  // --- email infrastructure (the product never sends email — see docs/privacy.md) ---
  'nodemailer',
  '@sendgrid/mail',
  '@sendgrid/client',
  'sendgrid',
  'mailgun',
  'mailgun-js',
  'mailgun.js',
  'postmark',
  '@aws-sdk/client-ses',
  'aws-ses',
  'node-ses',
  'resend',
  '@mailchimp/mailchimp_marketing',
  'mandrill-api',
  'emailjs',
]

const DENYSET = new Set(DENYLIST)

// Vitest's root config runs from the repo root, so cwd() IS the repo root; every manifest
// path resolves relative to it. (Verified: package.json / server|shared/package.json /
// pnpm-lock.yaml all resolve here.)
const REPO_ROOT = cwd()

interface Manifest {
  name: string
  /** Combined dependency-name keys from `dependencies` + `devDependencies`. */
  deps: string[]
}

/** Read one package.json, returning its combined dep keys. Throws (surface, don't swallow) if the
 *  file is missing or doesn't parse to an object — a path/parse mistake must be a loud failure, not
 *  a silently-empty (and therefore vacuously-passing) scan. */
function readManifest(relPath: string): Manifest {
  const raw = readFileSync(join(REPO_ROOT, relPath), 'utf8')
  const json: unknown = JSON.parse(raw)
  if (typeof json !== 'object' || json === null) {
    throw new Error(`${relPath} did not parse to an object`)
  }
  const pkg = json as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
  const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
  return { name: relPath, deps }
}

const MANIFEST_PATHS = ['package.json', 'server/package.json', 'shared/package.json']

describe('P2.7 privacy posture — no analytics/telemetry/email dependency (no-egress proof, dep half)', () => {
  const manifests = MANIFEST_PATHS.map(readManifest)

  // Non-vacuous guard: a path/parse mistake that yielded empty dep sets would make every
  // "not in denylist" assertion trivially pass. Prove we actually read real dependency data.
  it('reads real dependency data from all three manifests (non-vacuous)', () => {
    expect(manifests).toHaveLength(3)
    for (const m of manifests) {
      expect(Array.isArray(m.deps)).toBe(true)
      expect(m.deps.length).toBeGreaterThan(0)
    }
  })

  it.each(MANIFEST_PATHS)('%s declares no denylisted dependency', (relPath) => {
    const manifest = manifests.find((m) => m.name === relPath)!
    for (const dep of manifest.deps) {
      // EXACT-name match only — DENYSET.has, never substring.
      expect(DENYSET.has(dep), `${relPath} declares denylisted dependency "${dep}"`).toBe(false)
    }
  })

  // Transitive backstop: a denylisted vendor pulled in indirectly (not declared in any manifest)
  // is just as much an egress risk, so scan the resolved lockfile too.
  it('the resolved lockfile installs no denylisted package (transitive backstop)', () => {
    const raw = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8')

    const installed = new Set<string>()

    // pnpm lockfile (v9): the `packages:`/`snapshots:` sections key every resolved package as a
    // 2-space-indented `name@version:` line (optionally quoted, optionally with a `(peer@ver)`
    // suffix), e.g. `  '@babel/code-frame@7.26.2':` or `  use-sync-external-store@1.4.0(react@19.2.6):`.
    // A package pulled from git/a tarball/a local path instead of the registry keys as
    // `name@https://...`, `name@git+...`, `name@file:...`, or `name@link:...` — no digit after the
    // `@` — so the version-digit-only pattern silently skipped those rows, letting a denylisted
    // package slip the scan via a git fork. We extract the NAME (everything before the specifier)
    // line-by-line rather than adding a YAML parser dependency — a heavier dep tree is exactly what
    // this test polices.
    const keyLine = /^ {2}'?((?:@[^\s/']+\/)?[^\s@']+)@(?:\d|https?:|git\+|file:|link:)/
    for (const line of raw.split('\n')) {
      const match = keyLine.exec(line)
      if (match) installed.add(match[1])
    }

    // Non-vacuous: we must have parsed a real tree. (A lockfile format change that stops these
    // lines matching must fail HERE, loudly — not silently scan nothing and vacuously pass.)
    expect(installed.size).toBeGreaterThan(100)

    const offenders = [...installed].filter((name) => DENYSET.has(name))
    expect(offenders, `lockfile installs denylisted package(s): ${offenders.join(', ')}`).toEqual([])
  })
})
