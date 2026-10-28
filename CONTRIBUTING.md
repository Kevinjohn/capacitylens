# Contributing to CapacityLens

Thank you for helping. Small, focused pull requests with tests are easiest to review and merge.
For feature proposals, first check the deliberate scope in [DECISIONS.md](DECISIONS.md): budgets,
timesheets, hour-by-hour workflows and mobile scheduling are not planned.

## Your first change

1. Check [DECISIONS.md](DECISIONS.md) and the open issues; for anything beyond a small fix, open an
   issue and agree the approach before writing code.
2. Fork the repository and create a branch from `main`.
3. Follow [Set up](#set-up) below to install and run the app.
4. Make one focused change. Keep unrelated formatting and refactors out.
5. Typo and documentation changes: run `pnpm run format`, and `pnpm run docs:build` if you edited
   `docs-src/`. No other checks are needed.
6. Code changes: add a test that fails without the change, then run the checks in
   [Before opening a pull request](#before-opening-a-pull-request).
7. Add an entry under `CHANGELOG.md` → `Unreleased` if users will notice the change.
8. Commit with a sign-off: `git commit -s -m "Describe the change"` (see [Pull requests](#pull-requests)).
9. Push your branch and open a pull request; the template lists what to include.
10. Leave the pull request open and respond to review. Merging is the maintainer's decision.

## Runtime and dependency upgrades

The supported and recommended server runtime is Node 24.19.0 or later within 24.x. The package
engine declaration and backend startup guard also accept Node 26.9.0 or later within 26.x, but that
path remains experimental and best-effort: [`.nvmrc`](.nvmrc) selects Node 24 for development and
standard CI setup, while [`check:node26`](scripts/check-node26.mjs) covers selected compatibility
paths rather than the complete gate. Keep the documented production host boundary in the
[self-hosting installation guide](docs-src/self-hosting/install.md): Linux. CI also builds and
smoke-tests native packages on macOS arm64; that job does not add a production-host support
promise. The runtime floors are declared in [package.json](package.json) and enforced before the
backend starts in [node_version.ts](apps/backend/start/node_version.ts).

Use `nvm use` and the pinned pnpm version before changing dependencies. Ranges live in the root,
[backend](apps/backend/package.json), [frontend](apps/frontend/package.json) and
[shared](packages/shared/package.json) manifests; [pnpm-lock.yaml](pnpm-lock.yaml) records the
resolved workspace graph. Upgrade related AdonisJS packages as a compatible set. Keep the backend
and frontend Tuyau dependencies compatible, then regenerate the backend route client and type-check
its consumers. Account Kit is a vendored release archive: changing its pin also changes native
packaging and can affect sign-in, admission and sessions, so include the relevant backend auth tests
and packaged smoke checks.

The intended registry policy in [Dependabot configuration](.github/dependabot.yml) is separate
weekly groups for npm patch and minor updates, with majors reviewed manually from the
[monthly major report](.github/workflows/major-dependency-report.yml). GitHub Actions and Docker
updates stay monthly and patch-only. Advisories are checked by
`pnpm run gate:deps`. Keep [pnpm-workspace.yaml](pnpm-workspace.yaml) overrides only for a specific
advisory when consumers still allow the affected version; explain the reason beside the override
and remove it when no longer needed. Track a wider security upgrade and any exception in the issue
or pull request that owns the change. Dependabot reads its configuration from default `main`, and
scheduled workflows run there too: while this policy is only on a feature branch, do not rely on its
weekly updates or monthly report being active.

Choose checks for the changed boundary. Run focused tests first; framework or Tuyau changes also
need generated route types and the relevant backend/client type checks. Dependency and code changes
use the applicable [repository gate](.github/workflows/gate.yml) and
[browser suite](.github/workflows/e2e.yml).
Backend, runtime, native-module or packaged-runtime changes need the native package build and
packaged-server smoke checks on the workflow's Linux x64 and macOS arm64 targets. A prose-only
change needs formatting and content/link review; changes under `docs-src/` also need
`pnpm run docs:build`.

When a release changes the runtime floor or host, required configuration, database migration,
package format or recovery action, update the release notes and the relevant operator instructions
in `docs-src/self-hosting/`, especially [installation](docs-src/self-hosting/install-without-docker.md)
and [upgrades](docs-src/self-hosting/upgrades.md). State the required sequence and recovery action
operators can actually use. Do not copy historical compatibility investigations into the install
steps or treat experimental checks as a new support commitment.

## Set up

```bash
nvm use
corepack enable
pnpm install
pnpm run dev
```

`pnpm run dev:demo` starts the temporary in-memory demo without SQLite or authentication. The
workspace contains the web app, the pure `@capacitylens/shared` domain package, and the server.

## AdonisJS review record

The [26 October 2026 review bundle](https://gist.github.com/Kevinjohn/9c7367be1c8231f260ed1e3c3136535c)
records the framework-alignment, package-adoption and reusable-boundary assessments completed under
[#1604](https://github.com/Kevinjohn/capacitylens/issues/1604). It includes the findings register,
coverage and evidence records, reconciled recommendations and independent completeness assessment.

The reviewed source is `6c92d3710ed1d30bc925bd97e5d701ea551db452`, not the current branch.
The later integration checkpoint `f52bee5fe75604b33c1191294a80259825461aba` adds 28 commits and
changes 102 paths; the report's final status update qualifies that delta, which did not receive
the same complete review. Check the affected current source before acting on a finding.

The frozen-source verdict was changes required: archived-parent placeholder projection, late
inline-activity completion, mutation-test discovery and current security-documentation claims.
The report separates confirmed defects from conditional package trials and extraction proposals.
It does not establish security certification, production acceptance or package-adoption approval.
Implementation scope and current acceptance evidence remain in the owning GitHub issues.

## Lucid soft-delete integration

The backend pins `@kevinjohn/lucid-soft-deletes` version `0.1.1-alpha` as the packed asset from the
[tagged GitHub release](https://github.com/Kevinjohn/oss-adonisjs-lucid-soft-delete/releases/tag/v0.1.1-alpha)
in [`vendor/lucid-soft-deletes/`](vendor/lucid-soft-deletes/), built from upstream revision
[`a8e11145dada3f236c4d73422672cb0bf96f692f`](https://github.com/Kevinjohn/oss-adonisjs-lucid-soft-delete/commit/a8e11145dada3f236c4d73422672cb0bf96f692f).
Its SHA-256 is `72b69fd1ba01f64ce9bbd7cf5a358e725270ae57adc72600e2f6f3f58e2691cd`; verify the archive
against its adjacent checksum with `shasum -a 256 -c
vendor/lucid-soft-deletes/kevinjohn-lucid-soft-deletes-0.1.1-alpha.tgz.sha256`. This is a release
asset pin, not a registry dependency. Update the archive, checksum, backend manifest and lockfile
together.

Client, Project, Activity and Resource keep the package's Luxon `deletedAt` attribute. Their
serializers validate the UTC ISO timestamp sent to the shared domain and wire contract. Keep the
schema generator's deletion-column rule aligned with that type; ordinary product timestamps
retain their existing string contract.

Complete-state reads explicitly include trashed Client, Project, Activity and Resource rows. A root
`withTrashed()` does not change related queries; select the mode separately on every preload.
The shared `activeOnly` projection owns descendant hiding, using the complete parent state.
The package hides a model's own tombstone and does not implement application ancestry rules.

Archive transitions, planning revisions, audit rows and session-bound restoration groups already
exist in Adonis. The package integration does not introduce a public soft-delete or purge action,
a retention policy or deletion undo tokens for lifecycle models. Planning deletes for bookings,
time off, closures, phases and disciplines use package lifecycle operations. Their rows stay in
their own tables; the recovery ledger contains only expected row IDs and surviving-child links.
These five types keep internal deletion fields out of serialization and omit deleted rows even
from inactive-inclusive state reads. A group foreign key and mandatory company-matching
guards bind each retained row to its current deletion. Session and privacy cleanup cannot affect
a replacement or a later deletion. Package lifecycle operations and database bookkeeping share the caller's
transaction; after-hooks run before commit, so dispatch external effects only after that
transaction resolves.

[Issue #1640](https://github.com/Kevinjohn/capacitylens/issues/1640) records integration commands,
results; [issue #1653](https://github.com/Kevinjohn/capacitylens/issues/1653) records planning
recovery and cleanup acceptance.

## Beta transfer contract

The beta-native document has `format: "capacitylens-beta"`, `schemaVersion: 1` and
`completeness: "full" | "redacted"`. Its version is independent of database and legacy export
versions. `data` contains exactly one account and all scoped tables, preserving IDs, timestamps
and supported company settings. It excludes identity, sessions, memberships, roles, admission
records and device preferences. Only a full-completeness document can be prepared for import.

Shared preparation strictly validates fields and references, including account scope and current
member-to-person links. It rejects invalid data instead of repairing or remapping it. Redacted
exports preserve the server-projected confidential values and cannot be restored as a full
replacement.

The public entry point is `@capacitylens/shared/data/betaTransfer`: `buildBetaExport`,
`serializeBetaExport`, `parseBetaExport` and `prepareBetaImport`. Preparation receives explicit
server-owned `{ accountId, memberResourceLinks }` context and returns `{ data, imported }`, where
`imported` includes the account row. Export callers must supply an authorized, confidentially
projected dataset; the completeness marker grants no authority.

This is a preparation-only contract. The beta preview validates data and passes the prepared result
to its caller; it does not write to the server. Settings still uses the legacy importer and
exporter. Before activation, the writer must recheck authority and privileged proof, the expected
company revision and current member links inside its transaction. It must reject IDs already owned
by another company, preserve member/resource associations and durable planning mutation identities,
and replace planning rows and supported settings atomically. A changed replacement advances the
company revision and audit once; an unchanged replacement does neither. Do not pass prepared beta
data to the legacy remapping writer.

Before activation, import replacement, anonymisation and privacy scrubbing must invalidate affected
server-side restoration groups in the same transaction as the data change. Retained recovery data
must not restore replaced or scrubbed information after commit. Real SQLite acceptance must prove
that committed invalidation refuses restoration and that a failed transaction rolls back both the
data change and invalidation. Invalidation must preserve durable planning mutation commitment
identities. Coordinate this integration with the existing backend transaction and import/export
owners; do not add a competing writer.

## Before opening a pull request

Use the Node version in `.nvmrc`:

```bash
pnpm run gate:all
pnpm run e2e
```

While you work, `pnpm run check:changed [base]` runs only the checks for files changed since the
merge-base with `base` (default `origin/platform/adonisjs`), including uncommitted files. It builds
the application first when backend tests need it and a fresh worktree has no build yet. Add
`--static` to skip whole test suites and related-test lookups while still running the changed test
files, when one full run on a combined tree covers several changes. It does not replace the gate
above.

A prose-only change needs formatting and a content and link review instead; rebuild the
documentation when its sources change. Run the focused checks for changed behavior and preserve
the security, data-integrity and migration invariants in [DECISIONS.md](DECISIONS.md).

Authentication and account changes require focused backend tests for the affected authority and
failure paths. Provider checks use controlled responses; live-provider checks need an authorized
test registration and must be reported separately.

## Native production dialog acceptance

After building and packaging with `pnpm run build` and `pnpm run package:managed-release`, copy
`production/` outside the checkout and run:

```bash
pnpm run smoke:packaged-dialogs /absolute/path/to/copied-production/backend
```

Use the Node version in `.nvmrc`, an installed Playwright Chromium browser and `openssl`. This runs
against the packaged native production server with disposable SQLite data and password sign-in,
not the development server. A temporary loopback HTTPS edge preserves secure session cookies;
only the test browser accepts its self-signed certificate. On macOS a process-only preference makes
scrollbars visible without changing OS preferences. It runs the existing HTTP installation,
scheduling, backup and restore smoke as well as desktop/narrow modal scrolling, background locking,
scrollbar compensation, nested dialogs and selection, Escape, focus restoration and lock cleanup.
A separate page proves that the shipped CSP blocks an injected stylesheet and that the violation
guard detects it. Runtime style violations or uncaught browser exceptions fail acceptance.

Set `CAPACITYLENS_BROWSER_ARTIFACT_DIR` to a scratch directory to retain the two fictional-data
after screenshots. Browser contexts, TLS connections, server processes and disposable state are
closed or removed on success and failure. This command does not build, publish or deploy a release.

## Formatting

Prettier owns whitespace, quoting and line breaks. The root `.prettierrc.json` sets single quotes
and a 100-column width, matching the AdonisJS preset; the vendored shadcn primitives in
`apps/frontend/src/components/ui/` retain the upstream 80-column width and double quotes so
registry diffs show substantive changes instead of reflow noise, and stylesheets keep double quotes.
`apps/backend/.prettierrc.cjs` spreads the AdonisJS
preset and keeps semicolons, which the repository uses everywhere. Run `pnpm run format` before
committing: `pnpm run gate` fails on unformatted files.

Use clear names, small result shapes and explicit module boundaries. Style is not reviewable: if
Prettier produced it, it is correct. Reach for `// prettier-ignore` only when a hand-aligned block
genuinely reads better, and say why in the patch.

Run the applicable cross-browser suite for interaction or layout changes:

```bash
pnpm run e2e:webkit
pnpm run e2e:firefox
pnpm run e2e:browsers
pnpm run e2e:all
```

These conditions are local-development guidance for choosing extra checks before opening a pull
request. Pull requests run static analysis and CodeQL; documentation changes also run the docs
build. The full application/backend gate, native packages and Chromium/Firefox/WebKit
E2E suites run on `main` pushes, schedules or manual dispatch. Check the workflow files for the
current triggers and dispatch any required pre-merge evidence explicitly.

User-visible changes should update `user-stories/REFERENCE.md`, the matching story and its E2E
spec. New domain fields must flow through shared types, full fixtures, server table columns and
sanitisation so the compile-time exhaustiveness checks can protect them.

## Engineering standard

Write comments to explain why rather than restating what the code does; exported APIs need TSDoc.

When changing a data path, preserve the product and security invariants in [DECISIONS.md](DECISIONS.md).
In brief:

- Surface errors; never silently swallow them.
- Keep account reads scoped and let the server enforce membership on every write.
- Put environment-independent domain rules in `packages/shared/`; do not duplicate them in UI/server code.
- Preserve the three distinct workload signals and their time windows.
- Add tests that fail without the change.
- Never commit secrets, production data, generated output or personal deployment notes.

Authentication changes need explicit threat-oriented tests. Google is the
supported company provider; Microsoft is deferred and GitHub is retired. Provider changes must
remain secure when configuration is missing, partial or malicious.

## Pull requests

- Create pull requests on GitHub and leave them open for review; merging follows
  [GOVERNANCE.md](GOVERNANCE.md).
- Explain what changed and why.
- Link an issue when one exists.
- Keep unrelated formatting and refactors out of the patch.
- Note operational, migration, privacy or accessibility impact.
- Add an entry under `CHANGELOG.md` → `Unreleased` for user-visible changes.

Document implementation, design and investigation plans in GitHub issues. Do not add standalone
planning or ideation Markdown files to the repository.

Every contributor-authored commit must include a
[Developer Certificate of Origin](https://developercertificate.org/) sign-off whose email matches
the commit author or committer (after `.mailmap` normalization). GitHub-generated merge commits are
exempt; every commit on the feature branch still requires a sign-off:

```bash
git commit -s -m "Describe the change"
```

Delegated or unrelated sign-offs are not accepted. Commits authored by Dependabot are exempt;
other automated contributors must use an attributable author or committer sign-off.

By contributing, you agree that your contribution is licensed under AGPL-3.0-only. The project
does not currently require a copyright assignment or CLA.

## Community and security

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). For ordinary help use
[SUPPORT.md](SUPPORT.md). Never disclose a vulnerability in a public issue; use the private route
in [SECURITY.md](SECURITY.md).
