# CapacityLens repository guidance

## GitHub and execution access

GitHub access is available on the user's machine. A failure in one sandbox or tool does not
establish that GitHub, CI, credentials, Git writes or a supported runtime are unavailable.

- Use `gh` first for repository, push, pull-request and workflow operations. Attempt the actual
  needed operation; do not make a separate authentication ritual a prerequisite.
- If that route fails because of DNS, sandboxing, credentials or permissions, discover the
  authorised execution surfaces exposed by the current harness. Retry through available host
  execution, or use connected GitHub tools when they provide the operation. Do this before
  telling the user that access is blocked.
- Do not assume a particular terminal, browser or harness. Discover capabilities using the
  current tool inventory, including deferred tools when available. One missing terminal,
  connector or browser is not evidence that all alternatives are missing.
- Use browser/computer control only when CLI and connected tools cannot perform the operation.
  When operating a terminal UI, use an actual shell pane, never an agent/chat input.
- Do not ask the user to log in, run commands or repair the environment based only on a sandbox
  failure. Only report a blocker after checking the relevant available authorised alternatives.
  State the exact operation and concrete failures, not a blanket claim of no GitHub access.
- Do not repeat an unchanged failed route or bypass an explicit permission restriction.
  Distinguish an unavailable route, an authentication failure and a rejected action.
- Apply the same checks to CI: inability to dispatch or inspect a run through one route does
  not mean CI is unavailable. Verify the run and commit actually being inspected. A missing PR
  workflow, pending run, intentional skip and failed check are different states.

## Working workflow

- Complete the requested outcome with the simplest maintainable change and proportionate
  verification. Keep optional improvements separate from required work; do not add speculative
  enforcement, abstractions or process stages.
- For a new repository change, fetch `origin/main` with `git fetch origin main --prune`, then create
  a unique `feature/<short-description>` branch and sibling worktree from it. Never reuse or clean
  another task's branch/path. Report branch, path and base revision before editing.
- Resume an existing task in its assigned worktree. Keep every edit and command scoped to that
  worktree using the harness's supported working-directory mechanism. Start another session only
  if the current harness cannot safely target it. Do not implement in the primary checkout.
  These rules concern repository changes, not personal files outside the repository.
- Keep one cohesive task per branch/PR. Link an existing issue when applicable; a new issue is
  not a prerequisite unless requested. Group inseparable issues and explain the relationship.
- A request to complete implementation authorises the normal signed commit, push, PR and merge
  flow. Reviews and questions remain read-only unless implementation is requested. Do not ask
  again for already-authorised steps; ask only for unresolved consequential choices or scope changes.
- Review the complete branch diff before submission. Fix correctness, security, regression and
  required-standard findings within scope. Report every finding, including optional improvements;
  cosmetic suggestions do not block delivery or automatically authorise another PR.
- Use a short approach for simple work. Require independent design review for consequential
  architecture or contract decisions, not merely because a checklist was written.
- When parallel work is authorised, use cohesive packets with explicit ownership and acceptance
  criteria. Check dependencies as well as file overlap: disjoint files alone do not prove independence.
  Keep every intermediate merge valid. Independent changes may share validation on a recorded
  integrated tree when that evidence covers their guarantees; changed guarantees need fresh checks.
- Repeat review/checks when changes or new evidence invalidate prior results. For long work,
  identify useful delivery milestones and report implemented, verified and shipped work separately.
- Keep unrelated cleanup out of the diff. Later simplification requires its own scope and must
  preserve shared types, entities and public contracts unless their change is explicitly authorised.

## Product boundary

CapacityLens is a deliberately small, week-granularity agency capacity scheduler. Budgets,
timesheets, hour-by-hour workflows and mobile scheduling are non-goals.

## Architecture

- `shared/` is the pure domain core imported by app and server.
- `src/store/useStore.ts` orchestrates state, ids, timestamps and undo/redo.
- `src/components/scheduler/` builds the week-grid view-model.
- `server/` is the default SQLite API. `VITE_CAPACITYLENS_DEMO=1` selects the temporary in-memory
  demo; it must never persist scheduling data.
- Scoped reads go through `useScopedData` / `scopedTables()`. The server independently authorizes
  every tenant operation from session membership.
- When locating unfamiliar behaviour, consult the relevant “Task navigation” entry in
  `docs-src/reference/development.md`; task briefs should name that entry and the exact paths needed.

## Naming and module contracts

- Follow the naming, import-path and ownership tables in
  `docs-src/reference/development.md` → “Name modules and keep their contracts small”.
- Inside a module, follow `docs-src/reference/conventions.md` for function verbs, variable
  names, parameter style and result shapes. Existing differences are tracked debt; record them,
  do not fix them in an unrelated change.
- Match principal component/type exports with PascalCase filenames, hooks/utilities with
  camelCase filenames, and executable scripts with kebab-case filenames. Cohesive collections
  name their capability; preserve documented primitive, tool and public-contract exceptions.
- Give extracted modules explicit inputs containing only consumed capabilities. Keep orchestration
  visible and local helpers local; smaller files must reduce the reading context for a behavior.
- Preserve existing account/workspace/provider vocabulary and semantic ID aliases at their owning
  contracts. Naming changes never alter wire fields, stable identifiers or released migrations.

## Load-bearing invariants

- Every scoped entity carries `accountId`; `activeAccountId` is never persisted.
- Over-capacity means `allocated > available`, not equal. Ordinary allocations consume only the
  resource's working weekdays unless `ignoreWeekends` is set.
- Visible utilisation uses the currently visible zoom window. `overSoon` uses a fixed forward
  14-day window. Do not merge these signals.
- Use “Utilisation”, never “Load”, in the schedule UI.
- Activity `kind` is required. Only `project` activities may carry `projectId`/`phaseId`.
- Colours come from preset swatches; a person's colour derives from discipline.
- Invented people in seed data, demo logins, fixtures, tests and docs use comic-book character real
  names — DC for the first account (`a-studio`, Wayne Enterprises), Marvel for the second (`a-loft`,
  Stark Industries) — so no name can be mistaken for a real customer or colleague. Clients, projects
  and partner studios follow the same universes. Ids, emails and test-ids are stable identifiers and
  do not change when a display name does. `Northwind Identity`, the fictional identity provider in
  `docs-src/company-login/`, is deliberately outside this scheme.
- Forms reject invalid input; import/server sanitise and repair. Server imports are atomic.
- Device preferences are not account data. Offline snapshots are opt-in, seven-day and read-only;
  never add queued offline writes.
- Surface errors. No empty catches on a data path. Follow `DEFENSIVE-CODING.md`.
- New fields flow through shared types → full fixtures → server columns → explicit SQLite migration
  → sanitisation. Keep `EXPORT_SCHEMA_VERSION` and `DB_SCHEMA_VERSION` independent; retain every
  shipped migration and released database fixture. Never alter a released migration definition:
  the database ledger validates its name and SHA-256 checksum. Schema-affecting Better Auth upgrades
  also bump `DB_SCHEMA_VERSION`, even when the library owns the DDL.
  A migration adding a table or column also needs an anonymisation decision in the rehearsal
  script ledger; index-only migrations are exempt.

## Authentication

- Password auth and strict OIDC are supported; named social providers remain experimental.
- Production password mode lets operators require TOTP MFA and defaults to breached-password
  screening; fixed twelve-hour sessions and fresh administrative actions remain mandatory.
- New external principals require verified email plus an unused pre-authorised invitation. The
  first SSO identity requires `CAPACITYLENS_SSO_BOOTSTRAP_EMAILS`. An already-authenticated local
  principal may explicitly link a verified, email-matching strict-OIDC identity without consuming
  another invitation.
- Password mode may include providers; `sso` mode removes password sign-in.
- Never weaken server authorization because the UI hides an action.
- Password/session reset authority is identity-global: enforce it across every account the target
  can enter, and never render bearer session tokens.

## Frontend conventions

- Browser baseline is "Baseline widely available" as of Q3 2026. The verified matrix is Chromium by
  default, with WebKit/Firefox behind the `CAPACITYLENS_WEBKIT`/`CAPACITYLENS_FIREFOX` flags in
  `playwright.config.ts`. `color-mix(in oklab)`, `:has()`, `@container`, `svh`/`dvh` units,
  `field-sizing` and `text-wrap: balance` are already in use and considered safe. CSS anchor
  positioning (`anchor-name`/`position-anchor`) is not yet Baseline across that matrix; use Radix
  positioning instead.
- Give every icon-only button an accessible name, such as `aria-label`, independently of its hint.
  Simple hover hints use the native `title=` attribute by default. Reserve the
  Radix-based `Tooltip` in `ui/tooltip.tsx` for cases needing styled, delayed, or keyboard-accessible
  rich content (e.g. the collapsed sidebar rail in `AppSidebar`). This split is deliberate.
- The checked-in `src/components/ui/*` primitives are source-owned and may deliberately differ from
  the current shadcn registry in tokens, composition or exported surface. Every local deviation must
  carry an adjacent comment explaining why. Before re-pulling any installed primitive with
  `pnpm dlx shadcn add`, use the CLI dry-run/diff workflow and re-merge local behavior; never
  overwrite blindly. In particular, `button.tsx` adds `danger-soft`, custom icon sizes and retints
  `default`; `badge.tsx` carries AA-tuned `danger`/`warn` variants; and `dialog.tsx`,
  `alert-dialog.tsx`, `tooltip.tsx`, `toggle-group.tsx` and `alert.tsx` carry deliberate local
  behavior or variants documented beside the extension.
- Use the z-index tokens in `src/index.css` rather than ad hoc `z-[N]` values for global layers.

## Documentation

- `DECISIONS.md` holds standing decisions.
- `README.md` is public/product-facing; implementation details belong in `docs-src/reference/development.md`.
- User-facing docs are Markdown sources under `docs-src/`, built with VitePress plus
  `scripts/docs-standalone.mjs` into standalone static HTML committed at `docs/`
  (`pnpm run docs:dev` / `docs:build`), validated in CI by `.github/workflows/docs.yml`.
  After changes to documentation sources, embedded assets or build inputs, run `pnpm run docs:build`
  and commit regenerated `docs/`. Follow `docs-src/STYLE.md` for user-facing documentation.
  Other prose, such as this file or task notes, needs formatting and content/link review; rebuild
  the documentation only if it consumes those files.
- The operator set lives in `docs-src/self-hosting/` (install, configuration, TLS, backups,
  upgrades, monitoring, incidents) and `docs-src/company-login/` (sign-in modes, SSO cutover).
- Update `user-stories/REFERENCE.md` first for user-visible route, label, test-id or seed changes.
- Add user-visible changes under `CHANGELOG.md` → `Unreleased`.
- Authorised issue, pull-request and documentation work includes permission to publish reviewed
  project screenshots to GitHub, both as attachments and as committed documentation assets.
  Do not request separate upload approval for those screenshots. Use fictional/demo data or
  appropriately redacted examples, and exclude live credentials and private customer information.
  This permission does not authorise unrelated uploads or change an explicit instruction to leave
  pull requests unmerged.
- Documentation screenshots have no capture harness. Capture manually against the demo
  (`VITE_CAPACITYLENS_DEMO=1 pnpm exec vite --port 5199 --strictPort`) — never port 5173, which
  `playwright.config.ts` hardcodes, so a capture run there collides with any concurrent E2E run.
  Keep throwaway capture scripts in a scratch directory and out of the commit.
- Capture screenshots only after every UI change in the batch has landed, and open every changed
  image before merging: a stale capture is a valid image of UI that no longer exists, and no test
  can detect it. To identify potentially stale assets, compare each image's
  last-modifying commit against the merge commit of each UI change with
  `git merge-base --is-ancestor`, then inspect the affected captures; ancestry alone cannot prove
  visual correctness. Shared chrome and layout changes invalidate every capture that
  contains them, so the stale set is usually far larger than it looks.

### Stories and documentation checkpoint

Use this lightweight workflow for user-facing changes:

- When understanding an issue, identify the existing story in `user-stories/` that covers
  the user's problem. Update it when expected behaviour changes; add a story for a new
  capability. Stories describe lasting user needs, not individual issues or implementation steps.
- Keep stories focused on the user need and observable outcomes, including relevant defaults
  and access restrictions. Use those outcomes to guide tests, with technical edge cases covered
  separately. Follow existing story conventions rather than introducing another template.
- Give each affected story a link to the documentation page or section that explains how to
  accomplish it. Several stories can share a page; prefer updating an existing guide when it fits.
- Before finishing, compare the story and documentation with the implemented behaviour,
  including affected screenshots. Update them together and mention deliberate omissions briefly
  in the delivery summary.
- Apply judgment: purely visual fixes and internal changes may need no story update, although
  affected documentation or screenshots may still need refreshing. No new story per issue,
  separate tracking document, or repository-wide backfill is required.

## Docker

- Do not build or run Docker images, test in Docker, or change or maintain Dockerfiles, Compose
  configurations, Docker tests or Docker workflows unless the user explicitly requests that
  Docker work. This applies during releases too: a release request alone is not Docker
  authorisation. Use native local development and validation by default; existing Docker support
  does not make Docker work part of routine changes.

## Validation environment

- Run focused tests during implementation. Select submission checks using “Green gate” below.
- Before running Node or pnpm commands, activate the version selected by `.nvmrc` in that
  worktree and verify `node --version`; do not use the machine default. Include this requirement
  in delegated briefs and reapply it when switching shells or execution tools.
- Under Node 22, server tests fail with `db.setAuthorizer is not a function`. Restricted
  environments may also produce EPERM errors; use the `.nvmrc` version for valid gate evidence.
- Treat failures seen only in unsupported runtimes or restricted filesystems as
  environment-specific until they are reproduced in the supported validation environment.

## Known pitfalls

Check these constraints before making related changes; violating them commonly causes avoidable
validation failures.

- Bumping `DB_SCHEMA_VERSION` (or adding a migration/fixture) requires extending the released
  version pins in `server/src/backup.test.ts` and adding new migration checksum pins in
  `server/src/db.migrate.test.ts` (checksums of released migrations must never change).
- Within a migration, create SQLite triggers only after every table and column they reference
  exists; trigger creation order relative to DDL matters.
- After editing `messages/en.json`, run `pnpm run paraglide:compile` (the `test`/`build` scripts do
  this automatically, but direct `vitest`/`tsc` invocations do not) or type-checking will fail on
  stale generated messages.
- Merging `origin/main` into a feature branch across a release boundary can silently move that
  branch's `[Unreleased]` changelog entry into the newly dated section. The release moved the
  heading above the entry, so Git auto-resolves it without a conflict and the result stays valid
  Markdown, which no test rejects. After any such merge, read the head of `CHANGELOG.md` and
  confirm the branch's own entry is still under `Unreleased`. Releasing once per batch rather than
  once per change avoids most of these boundaries entirely.
- `docs-src/security/crypto-inventory.json` pins every file that imports `node:crypto`, by path.
  Moving or splitting such a file (for example extracting a route module) fails
  `pnpm run gate:server` at the crypto-inventory step until the entry follows the code. After
  editing the ledger, run `pnpm run docs:build`: the standalone docs embed a copy under `docs/`.
- A version bump must update both the new `[x.y.z]:` comparison link and the `[Unreleased]:` link.
  Only `pnpm run gate:server` asserts this; the app-side suite passes with a stale link.
- The full validation suites compete for the same machine. Run them concurrently only in
  combinations that do not starve each other. Failures in untouched files can still be regressions
  through changed dependencies. Treat contention as a hypothesis; obtain evidence or rerun in
  isolation before discounting a failure. Run only one E2E suite at a time across worktrees because
  it binds fixed ports.

## Green gate

- Prose-only changes require formatting and content/link review. Run the documentation build when
  its inputs change (see “Documentation”). Application suites are not required for prose alone.
- Other changes default to `pnpm run gate`, `pnpm run gate:server` and `pnpm run e2e` before
  submission on Node >= 24. Cross-browser and mutation checks are documented in
  `docs-src/reference/development.md`; keep E2E specs browser-agnostic.
- Programme exception, agreed 7 September 2026: only work explicitly governed by `tasks/plan.md`
  follows its risk-based validation and programme-specific CI/release policy instead of the
  defaults here. Owners run focused tests, applicable type/lint/format and size/baseline checks;
  the coordinator owns the three full suites at a recorded integrated milestone before release.
  Docker and mutation suites are excluded for that programme. Do not carry its skip-CI policy
  into unrelated work. Current explicit user instructions supersede historical plan decisions.

## Git and GitHub flow

- Commit each logical change with `git commit -s`; every feature commit requires a matching DCO
  `Signed-off-by` trailer. Generated merge commits are exempt.
- After the review gate passes, push the feature branch and open a ready-for-review pull request into
  `main`. Link its issue with a closing keyword when applicable. Never push task commits directly to
  `main`.
- Merge validated pull requests with a normal merge commit and delete the remote feature branch:
  `gh pr merge <number> --merge --delete-branch`. Respect dependency order and land one pull request
  at a time unless independent changes materially benefit from parallel validation.
- Never squash, rebase or rewrite branch history unless the user explicitly requests it for that
  operation.
- After each merge, verify the pull request, merge commit, linked issue and remote branch deletion,
  fast-forward local `main` when safe, then remove the task's isolated worktree and local branch.
  First inspect both worktrees for uncommitted/unrelated work; preserve it and never force cleanup.
  If local changes prevent updating main, report the exact overlap without stashing or discarding them.

## Version and CI policy

- Read the checked-in workflow triggers when selecting CI. CodeQL runs on pull requests; the
  main gate and E2E workflows run on main pushes or manual dispatch (and their configured schedules
  or tags). Do not infer missing access from the absence of automatic PR checks.
- Dispatch relevant workflows before merge when required by the task or risk.
  `gh workflow run gate.yml --ref <branch>` runs only the gate workflow;
  E2E, security and other workflows are separate.
  For a request for full GitHub CI, inventory and dispatch the applicable workflows, honour explicit
  exclusions, and verify their results against the intended commit. Never describe one green
  workflow or an intentional skip as full CI success.
- Treat a requested version bump as a release task, not merely as a description of the change.
- One release covers a batch. When several small changes are being landed together, land every
  functional pull request first and take a single version bump at the end. A release per change
  multiplies the whole release flow by the number of changes for no user-visible gain, and each
  release moves the changelog heading underneath every branch still in flight.
- After the functional change lands, create a separate version-only branch and worktree. Update the
  root and server package versions, move only the release's eligible changelog entries into the new
  dated section, leave unrelated entries under `Unreleased`, and update comparison links.
- A patch-version-only pull request skips CI by default: do not dispatch a workflow, and put
  `[skip ci]` in the release PR title so it is included in the normal merge commit message. Do not
  use `[skip ci]` on the preceding functional change.
- For a minor-version release, ask whether GitHub CI should run only if the user has not already
  specified. For a major-version release, run the applicable full GitHub CI and wait for success.
