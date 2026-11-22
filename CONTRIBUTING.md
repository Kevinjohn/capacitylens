# Contributing to CapacityLens

Thank you for helping. Small, focused pull requests with tests are easiest to review and merge.
For feature proposals, first check the deliberate scope in [DECISIONS.md](DECISIONS.md): budgets,
timesheets, hour-by-hour workflows and mobile scheduling are not planned.

- **Making your first change?** Follow [Your first change](#your-first-change).
- **Back for another pull request?** Go to [Checks by change type](#checks-by-change-type).

## Your first change

1. Check [DECISIONS.md](DECISIONS.md) and the open issues; for anything beyond a small fix, open an
   issue and agree the approach before writing code.
2. Fork the repository, clone it and create a branch from `main`.
3. Follow [Set up](#set-up), then run `pnpm run dev:demo` to see the app with demo data.
4. Find what to edit with the README's [Where do I edit?](README.md#where-do-i-edit) map; the
   [architecture reference](docs-src/reference/architecture.md) shows where each capability lives
   and which tests pin it.
5. Make one focused change. Keep unrelated formatting and refactors out.
6. Code changes: add a test that fails without the change. To show it, commit, revert or alter the
   changed code, run the focused test, confirm it fails, then restore the change. Typo and
   documentation changes need no test.
7. Run the checks for your change type in [Checks by change type](#checks-by-change-type).
8. Commit with a sign-off: `git commit -s -m "Describe the change"` (see [Pull requests](#pull-requests)).
9. Write the pull-request title as the release-note line, for a person using the product, and give
   the pull request one category label. Push your branch and open the pull request; the template
   lists what to include.
10. Leave the pull request open and respond to review. Merging is the maintainer's decision.

## Set up

```bash
nvm use
corepack enable
pnpm install
cp apps/backend/.env.example apps/backend/.env
cd apps/backend
node ace.js generate:key --show
```

Copy the generated value into `APP_KEY` in `apps/backend/.env`, then return to the repository root:

```bash
cd ../..
```

The example file leaves `APP_KEY` empty; do not commit your `.env` file.
Initialise the local SQLite database and run its migrations before starting the full-stack
development servers:

```bash
mkdir -p apps/backend/tmp
pnpm --dir apps/backend exec node ace.js app:upgrade
pnpm run dev
```

For local sign-in without email, set `CAPACITYLENS_CREATE_ADMIN_ADMIN=true` and choose a local
`CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD` of 15–128 characters in `apps/backend/.env`. This
development convenience is refused in production.

The development bootstrap uses the reserved local identity `admin@admin.admin`. If startup reports
that this identity exists but is not admitted, do not reset its password or adopt an account by email
alone. First set `CAPACITYLENS_CREATE_ADMIN_ADMIN=false` temporarily and start the local server.
Sign in as the reserved identity and inspect `GET /api/admission`. Confirm the identity came from an
interrupted bootstrap in this local database. Stop the development server before running only the
command for an unmet requirement from `apps/backend/`:

```bash
node ace.js account-kit:admission:grant-invitation admin@admin.admin --role admin
node ace.js account-kit:admission:approve admin@admin.admin
```

These commands preserve the existing identity and password. If you cannot verify the identity's
origin, stop and use a fresh local database instead of changing its admission. Restart with
`CAPACITYLENS_CREATE_ADMIN_ADMIN=true` after the required admission steps succeed.

## Daily development

```bash
pnpm run dev        # full stack on your local database
pnpm run dev:demo   # full stack on disposable demo data
pnpm run check:changed
```

`pnpm run dev:demo` starts the full stack on disposable SQLite storage and prints its development
sign-in. Refresh keeps changes; restarting resets the demo company. Normal `pnpm run dev` keeps
the empty-install setup journey. The workspace contains the web app, pure shared domain package
and server.

While you work, `pnpm run check:changed [base]` runs only the checks for files changed since the
merge-base with `base` (default `origin/main`), including uncommitted files, and prints why it
selected each one. A backend source change runs the specs that import it; shared contracts,
dependencies, permissions, schema, configuration, test infrastructure and backend files no spec
imports run the whole backend suite. It builds the application first when backend tests need it
and a fresh worktree has no build yet. Add `--static` to skip whole test suites and related-test
lookups while still running the changed test files, when one full run on a combined tree covers
several changes. It does not replace the submission gate in
[Before opening a pull request](#before-opening-a-pull-request).

Run `pnpm check:changed --plan origin/main` to preview the same commands in execution order,
including preparation, selection reasons and skips. The wrapper claims a port lane, but no planned
command runs. The preview reflects the current diff and filesystem. For example, the application
build drops out once its assets exist.

## Checks by change type

`pnpm run check:changed [base]` picks the checks for the files you changed. Before opening a pull
request, also run the submission gate in [Before opening a pull request](#before-opening-a-pull-request)
unless your change is prose-only.

| Change                                | Focused check while you work                                                 | Also needed                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Documentation (`docs-src/`, Markdown) | `pnpm run format`                                                            | `pnpm run docs:build` (its `docs/` output is not committed); no gate                                   |
| Frontend (`apps/frontend/`)           | `pnpm run check:changed` (format, lint, type-check, related tests)           | The gate; the [cross-browser suites](#before-opening-a-pull-request) for interaction or layout changes |
| Backend (`apps/backend/`)             | `pnpm run check:changed` (runs the specs that import the changed files)      | The gate; focused authority and failure-path tests for authentication and account changes              |
| Shared (`packages/shared/`)           | `pnpm run check:changed` (runs the whole backend suite for shared contracts) | The gate                                                                                               |
| Dependencies or runtime               | `pnpm run check:changed`                                                     | See [Runtime and dependency upgrades](#runtime-and-dependency-upgrades)                                |

## Before opening a pull request

Use the Node version in `.nvmrc`:

```bash
pnpm run gate:all
pnpm run e2e
```

A prose-only change needs formatting and a content and link review instead; rebuild the
documentation when its sources change. Run the focused checks for changed behaviour and preserve
the security, data-integrity and migration invariants in [DECISIONS.md](DECISIONS.md).

Authentication and account changes require focused backend tests for the affected authority and
failure paths. Use controlled responses for external-service behaviour; any live-service check needs
an authorised test account and must be reported separately.

Run the applicable cross-browser suite for interaction or layout changes:

```bash
pnpm run e2e:webkit
pnpm run e2e:firefox
pnpm run e2e:browsers
pnpm run e2e:all
```

WebKit and Firefox run only the tests tagged `@engine`. Tag a new browser test, or its
`describe`, with `{ tag: '@engine' }` when its result can differ between engines, for example
dragging and resizing, keyboard movement, focus, scrolling, native inputs, layout, accessibility
scans, navigation and unload, or browser storage. A test that only checks a
domain result stays untagged and runs on Chromium.

These conditions are local-development guidance for choosing extra checks before opening a pull
request. CI runs:

- **Pull requests:** static analysis owns formatting, lint and the type-check (formatting only for
  a documentation-only change); `check:changed --tests-only` runs the selected tests; changed
  end-to-end specs run on their own, and a fixture, helper or Playwright configuration change runs
  the Chromium and auth suites. Documentation changes run the docs build, code changes run
  CodeQL, and packaging, runtime-dependency or container changes run the native package and
  container smoke checks.
- **`main` pushes:** the production build, full frontend and backend tests, format, lint and
  type-check in parallel jobs, tooling-policy checks when their inputs change, and a short Chromium
  journey (sign-in, the planner and saving an allocation).
- **Weekly and manual full validation:** every tooling check, frontend coverage, the native
  packages, Chromium, Firefox and both WebKit shards, the full-history secret scan, container
  scans, the ZAP baseline and Scorecard.
- **`v*` tags:** full validation of the tagged commit, container smoke and release scans. Archives
  and images publish only after the tag's Validation and Docker runs succeed.

Dispatch [Validation](.github/workflows/validation.yml) for any required pre-merge evidence.

User-visible changes should update `user-stories/REFERENCE.md`, the matching story and its E2E
spec. A new domain field is added to the field table
(`packages/shared/src/types/entityFields.ts`), the entity interface, the migration and the model;
the compile-time checks then name every validator and list that must follow.

## Pull requests

- Create pull requests on GitHub and leave them open for review; merging follows
  [GOVERNANCE.md](GOVERNANCE.md).
- Explain what changed and why.
- Link an issue when one exists.
- Keep unrelated formatting and refactors out of the patch.
- Note operational, migration, privacy or accessibility impact.
- The pull-request title is the release-note line: write it for a person using the product. Add one
  category label: `enhancement`, `bug`, `documentation`, `dependencies`, `maintenance` or
  `tech-debt`. A breaking API change uses `breaking` and says what to change in the first line of
  the description.

Document implementation, design and investigation plans in GitHub issues. Do not add standalone
planning or ideation Markdown files to the repository.

Every contributor-authored commit must include a
[Developer Certificate of Origin](https://developercertificate.org/) sign-off whose email matches
the commit author or committer (after `.mailmap` normalisation). GitHub-generated merge commits are
exempt; every commit on the feature branch still requires a sign-off:

```bash
git commit -s -m "Describe the change"
```

Delegated or unrelated sign-offs are not accepted. Commits authored by Dependabot are exempt;
other automated contributors must use an attributable author or committer sign-off.

By contributing, you agree that your contribution is licensed under GPL-3.0-or-later. The project
does not currently require a copyright assignment or CLA.

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

## Engineering standard

The [code standards](docs-src/reference/code-standards.md) page sets how code is formatted, named,
documented and reviewed, including the comment and TSDoc rules.

When changing a data path, preserve the product and security invariants in [DECISIONS.md](DECISIONS.md).
In brief:

- Surface errors; never silently swallow them.
- Keep account reads scoped and let the server enforce membership on every write.
- Put environment-independent domain rules in `packages/shared/`; do not duplicate them in UI/server code.
- Preserve the three distinct workload signals and their time windows.
- Add tests that fail without the change.
- Never commit secrets, production data, generated application output or personal deployment notes.

Authentication changes need explicit threat-oriented tests. Account Kit owns password-only sign-in;
there is no identity-provider or social sign-in. Tests should cover the affected authority and
failure paths, including missing or invalid configuration.

## Documentation and GitHub Pages

Edit Markdown in `docs-src/`; `docs/` is generated site output and is not committed. Run
`pnpm run docs:build` after changing documentation to check links and navigation; `docs/` then
holds a copy that opens from disk with no server. GitHub Pages publishes only when an authorised
maintainer runs `gh workflow run pages.yml --ref main`, which builds the site from `main` in that
run; publishing a release does not update the site. The workflow accepts only `main`, so merge the
source before publishing.

## Runtime and dependency upgrades

The supported and recommended server runtime is Node 24.19.0 or later within 24.x. The package
engine declaration and backend startup guard also accept Node 26.9.0 or later within 26.x, but that
path remains experimental and best-effort: [`.nvmrc`](.nvmrc) selects Node 24 for development and
standard CI setup, while [`check:node26`](scripts/ci/check-node26.mjs) covers selected compatibility
paths rather than the complete gate. Keep the documented production host boundary in the
[self-hosting installation guide](docs-src/self-hosting/install.md): Linux. The runtime floors are
declared in [package.json](package.json) and enforced before the backend starts in
[node_version.ts](apps/backend/bin/node_version.ts).

Keep patch and minor updates within the existing runtime and browser requirements. Check dependency
engines, peers and generated output, and verify on the minimum supported Node 24 version. Treat an
increase to a minimum requirement as a separate product decision; a newer package alone does not
justify excluding an otherwise supported installation.

Use `nvm use` and the pinned pnpm version before changing dependencies. Ranges live in the root,
[backend](apps/backend/package.json), [frontend](apps/frontend/package.json) and
[shared](packages/shared/package.json) manifests; [pnpm-lock.yaml](pnpm-lock.yaml) records the
resolved workspace graph. Upgrade related AdonisJS packages as a compatible set. Keep the backend
and frontend Tuyau dependencies compatible, then regenerate the backend route client and type-check
its consumers. Account Kit is pinned to a GitHub release asset URL: changing its pin also changes native
packaging and can affect sign-in, admission and sessions, so include the relevant backend auth tests
and packaged smoke checks.

TypeScript 5.9.3 is the tested compiler baseline for the launch dependency set and is pinned in the
root, backend and frontend manifests. A package's consumer peer range may allow a newer compiler
without requiring this repository to adopt it. If an upgrade requires a higher compiler, Node floor
or browser target, make that a separate launch-compatibility decision supported by validation
([issue #1731](https://github.com/Kevinjohn/capacitylens/issues/1731)).

The intended registry policy in [Dependabot configuration](.github/dependabot.yml) is separate
weekly groups for npm patch and minor updates, with majors reviewed manually from the
[monthly major report](.github/workflows/major-dependency-report.yml). GitHub Actions and Docker
updates stay monthly and patch-only. Advisories are checked by
`pnpm run check:deps`. Keep [pnpm-workspace.yaml](pnpm-workspace.yaml) overrides only for a specific
advisory when consumers still allow the affected version; explain the reason beside the override
and remove it when no longer needed. Track a wider security upgrade and any exception in the issue
or pull request that owns the change. Dependabot reads its configuration from the default branch,
`main`, and scheduled workflows run there too.

Choose checks for the changed boundary. Run focused tests first; framework or Tuyau changes also
need generated route types and the relevant backend/client type checks. Dependency and code changes
use the applicable [repository gate](.github/workflows/gate.yml) and
[browser suite](.github/workflows/e2e.yml).
Backend, runtime, native-module or packaged-runtime changes need the native package build and
packaged-server smoke checks on the workflow's Linux x64 target. A prose-only change needs
formatting and content/link review; changes under `docs-src/` also need `pnpm run docs:build`.

When a release changes the runtime floor or host, required configuration, database migration,
package format or recovery action, update the release notes and the relevant operator instructions
in `docs-src/self-hosting/`, especially [installation](docs-src/self-hosting/install-without-docker.md)
and [upgrades](docs-src/self-hosting/upgrades.md). State the required sequence and recovery action
operators can actually use. Do not copy historical compatibility investigations into the install
steps or treat experimental checks as a new support commitment.

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
scheduling, backup and restore smoke as well as desktop/narrow dialog scrolling, background locking,
scrollbar compensation, nested dialogs and selection, Escape, focus restoration and lock cleanup.
A separate page proves that the shipped CSP blocks an injected stylesheet and that the violation
guard detects it. Runtime style violations or uncaught browser exceptions fail acceptance.

Set `CAPACITYLENS_BROWSER_ARTIFACT_DIR` to a scratch directory to retain the two fictional-data
after screenshots. Browser contexts, TLS connections, server processes and disposable state are
closed or removed on success and failure. This command does not build, publish or deploy a release.

## Reference records

- The [AdonisJS review record](docs-src/security/reviews.md#adonisjs-review-record)
  (26 October 2026) lists the framework-alignment review and its limits.
- [Lucid soft-delete integration](docs-src/reference/architecture.md#lucid-soft-delete-integration)
  covers the pinned package, trashed reads and planning deletes.
- The [beta import contract](docs-src/reference/architecture.md#beta-import-implementation)
  defines the import/export document and its server-side apply.

## Releases

Release notes are generated from merged pull-request titles and grouped by label through
[`.github/release.yml`](.github/release.yml). To release, bump the version in `package.json`, tag
that commit, then create a draft with generated notes and edit it before publishing:

```bash
gh release create <tag> --generate-notes --draft
```

Releases up to 0.75.0-alpha.1 are recorded in the frozen [changelog archive](https://github.com/Kevinjohn/capacitylens/blob/88abfe6a0a4b53af533c6b4ba5f74080100653b4/CHANGELOG-ARCHIVE.md); later notes are on the [Releases page](https://github.com/Kevinjohn/capacitylens/releases).

## Community and security

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). For ordinary help use
[SUPPORT.md](SUPPORT.md). Never disclose a vulnerability in a public issue; use the private route
in [SECURITY.md](SECURITY.md).
