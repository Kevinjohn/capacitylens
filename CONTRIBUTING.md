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

## Set up

```bash
nvm use
corepack enable
pnpm install
pnpm run dev
```

`pnpm run dev:demo` starts the temporary in-memory demo without SQLite or authentication. The
workspace contains the web app, the pure `@capacitylens/shared` domain package, and the server.

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

## Before opening a pull request

Use the Node version in `.nvmrc`:

```bash
pnpm run gate:all
pnpm run e2e
```

A prose-only change needs formatting and a content and link review instead; rebuild the
documentation when its sources change. Run the focused checks for changed behavior and preserve
the security, data-integrity and migration invariants in [DECISIONS.md](DECISIONS.md).

Authentication and account changes require focused backend tests for the affected authority and
failure paths. Provider checks use controlled responses; live-provider checks need an authorized
test registration and must be reported separately. Migration changes must preserve every released
migration checksum and exercise `app:upgrade`, backup and rollback refusal behavior.

## Formatting

Prettier owns whitespace, quoting and line breaks. The project uses `printWidth: 120`, except for
the vendored shadcn primitives in `apps/frontend/src/components/ui/`, which retain the upstream 80-column width
so registry diffs show substantive changes instead of reflow noise. Everything else is stock. Run
`pnpm run format` before committing — `pnpm run gate` fails on unformatted files.

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
