# CapacityLens repository guidance

## Working workflow

- Follow KISS (Keep It Simple, Stupid): use the fewest workflow steps and roles that safely deliver
  the requested result. Do not invent approval gates, reviewer roles or process stages unless the
  user asks for them or a required external policy imposes them.
- Any task that changes files gets a unique `feature/<short-description>` branch and linked worktree,
  unless the user explicitly says otherwise. Run `git fetch origin main --prune`, then branch the
  worktree from `origin/main`. If the branch or path exists, choose another; never reuse or clean it.
  Never implement in the primary checkout or another task's worktree. Report the branch, worktree
  and base revision before editing.
- Create the worktree as a sibling directory named for the task, before any edit. A session whose
  working directory is the primary checkout cannot relocate itself part-way through a task, so
  either enter the new worktree using the mechanism your harness provides for that, or start a
  fresh session whose working directory is the worktree. Concurrent tasks each get their own
  worktree and their own session, so they never contend for the same files.
- Default to one issue per branch and one pull request per issue. Group issues only when they are
  inseparable or a combined change is materially clearer, and explain the reason in the pull request.
- Make the smallest, simplest maintainable change that completely solves the request. Keep unrelated
  cleanup, formatting, refactors, dependencies and abstractions out of the diff.
- Before creating a pull request, run the applicable checks and review the complete branch diff
  against its base. Fix all actionable findings and repeat the checks and review until green.
- A user request to complete a task or programme of work authorises its normal branch, commit, push,
  pull request and merge flow. Continue through those steps without inserting additional approval
  pauses. Stop only when a consequential choice is genuinely unresolved, an action would exceed the
  requested scope, or validation exposes a blocker that cannot be resolved safely.
- Keep the user informed with concise progress updates and report each pull request's scope, review
  result and validation evidence.

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

## Authentication

- Password auth and strict OIDC are supported; named social providers remain experimental.
- Production password mode supports optional required TOTP MFA and defaults to breached-password
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
- Icon-only buttons and simple hover hints use the native `title=` attribute by default. Reserve the
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
  After any docs change, run `pnpm run docs:build` and commit the regenerated `docs/`.
  Follow `docs-src/STYLE.md` for any docs change.
- The operator set lives in `docs-src/self-hosting/` (install, configuration, TLS, backups,
  upgrades, monitoring, incidents) and `docs-src/company-login/` (sign-in modes, SSO cutover).
- Update `user-stories/REFERENCE.md` first for user-visible route, label, test-id or seed changes.
- Add user-visible changes under `CHANGELOG.md` → `Unreleased`.

## Validation environment

- Run focused tests for affected files during implementation. Run the repository's complete
  validation commands before submission using Node >= 24.
- CapacityLens requires Node >= 24. Under Node 22, server tests fail with
  `db.setAuthorizer is not a function`. Restricted environments may also produce EPERM errors;
  only Node >= 24 runs are valid gate evidence.
- Treat failures seen only in unsupported runtimes or restricted filesystems as
  environment-specific until they are reproduced in the supported validation environment.

## Known pitfalls

Check these constraints before making related changes; violating them commonly causes avoidable
validation failures.

- Released SQLite migrations are checksum-pinned: the database ledger validates each migration's
  name and SHA-256. Never edit a shipped migration file — schema changes always mean a new
  migration.
- Bumping `DB_SCHEMA_VERSION` (or adding a migration/fixture) requires extending the released
  version and fixture pins in the server backup/restore tests (`server/src/backup.test.ts`,
  `server/src/restore.drill.test.ts`).
- Within a migration, create SQLite triggers only after every table and column they reference
  exists; trigger creation order relative to DDL matters.
- After editing `messages/en.json`, run `pnpm run paraglide:compile` (the `test`/`build` scripts do
  this automatically, but direct `vitest`/`tsc` invocations do not) or type-checking will fail on
  stale generated messages.

## Green gate

Run `pnpm run gate`, `pnpm run gate:server` and `pnpm run e2e`. Cross-browser and mutation suites
are documented in `docs-src/reference/development.md`. Keep E2E specs browser-agnostic.

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
  update local `main`, then remove the isolated worktree and local feature branch.

## Version and CI policy

- No workflow runs on a pull request. CI runs when a merge reaches `main`, or on demand with
  `gh workflow run gate.yml --ref <branch>`. Dispatch before merging when the change warrants it.
- Treat a requested version bump as a release task, not merely as a description of the change.
- After the functional change lands, create a separate version-only branch and worktree. Update the
  root and server package versions, move only the release's eligible changelog entries into the new
  dated section, leave unrelated entries under `Unreleased`, and update comparison links.
- A patch-version-only pull request skips CI by default: do not dispatch a workflow, and put
  `[skip ci]` in the release PR title so it is included in the normal merge commit message. Do not
  use `[skip ci]` on the preceding functional change.
- For a minor-version release, ask the user whether GitHub CI should be run before proceeding.
- For a major-version release, GitHub CI must be run and pass; do not skip it.
