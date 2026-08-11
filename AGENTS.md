# CapacityLens repository guidance

## Working method

### Isolated task branches and worktrees

- Unless the user explicitly requests a different arrangement, every task gets its own unique
  `feature/<short-description>` branch and its own unique linked worktree. One task owns one branch
  and one worktree; never reuse either for another task.
- Create the branch and worktree from the latest `origin/main` before editing. A typical start is
  `git fetch origin main --prune`, followed by
  `git worktree add -b feature/<short-description> <unique-worktree-path> origin/main`.
- Report the branch, worktree path and base revision before making changes so the user can verify
  the isolation.
- Never implement task work in the primary checkout, switch the primary checkout's branch, or
  modify another task's worktree. Preserve unrelated dirty files and concurrent work exactly as
  found.
- If a proposed branch name or worktree path already exists, choose a new unique pair. Never clean,
  reset, delete or repurpose an existing branch or worktree to make room.
- Keep all implementation, validation, review, commits and PR preparation inside the task's
  worktree. Remove the worktree and local task branch only after the merge is verified and no
  unpushed work remains.

### Smallest complete change

- Make the smallest, simplest maintainable change that fully solves the requested problem.
- Keep the diff limited to the requested behaviour and directly required tests, documentation,
  migrations or generated artifacts. Do not include unrelated cleanup, formatting, refactors,
  dependency changes or speculative abstractions.
- Prefer a direct fix over a new layer or generalized framework. Split code only when a cohesive
  boundary is needed to keep the affected code readable and focused.

### Review gate before a pull request

- Do not create a pull request immediately after implementation, even when the original request
  asks for one. First run the applicable validation and review the complete branch diff against its
  base (`origin/main...HEAD`), including every changed file and the affected behaviour.
- Present the review results to the user. Report every finding, including low-priority concerns,
  test gaps, documentation issues, nits and unresolved questions; do not silently filter findings.
- Address every accepted or actionable finding in the isolated worktree, rerun the affected checks
  and review the complete diff again. Repeat until the review has no actionable findings and all
  applicable checks are green.
- After the green review, show the user the final scope, diff summary and validation evidence, then
  wait for explicit approval before pushing or creating the pull request.

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

## Green gate

Run `pnpm run gate`, `pnpm run gate:server` and `pnpm run e2e`. Cross-browser and mutation suites
are documented in `docs-src/reference/development.md`. Keep E2E specs browser-agnostic.

## Git and GitHub flow

- Land work through a pull request from its isolated feature branch into `main`. Do not push task
  commits directly to `main`.
- Commit each logical change with `git commit -s`; every commit requires a DCO `Signed-off-by`
  trailer matching its author or committer. Do not combine unrelated changes in one commit.
- Push and open the pull request only after the review gate above is green and the user approves
  publication. Open it ready for review unless the user explicitly asks for a draft.
- Merge only after the user explicitly approves the merge. Use a normal merge commit so the feature
  branch's commits and topology remain intact. The merge commit must also carry the matching DCO
  sign-off. Use:

  ```bash
  gh pr merge <number> --merge --delete-branch \
    --author-email "$(git config user.email)" \
    --body "Signed-off-by: $(git config user.name) <$(git config user.email)>"
  ```

- Never squash-merge or rebase-merge. Do not use `gh pr merge --squash`, `gh pr merge --rebase`,
  `git rebase` or another history-rewriting substitute unless the user explicitly overrides this
  repository rule for that specific operation.
- After merging, verify the PR state, merge commit, DCO sign-off, linked issue state and remote
  branch deletion before reporting completion.

## Version and CI policy

- No workflow runs on a pull request. CI runs when a merge reaches `main`, or on demand with
  `gh workflow run gate.yml --ref <branch>`. Dispatch before merging when the change warrants it.
- Treat a requested version bump as an explicit release task, not merely as a description of the
  change's semantic-versioning category.
- A patch release uses a separate version-only feature branch and worktree after the functional
  change has landed. Update the root and server package versions, move only the patch-eligible
  `CHANGELOG.md` entries into the new dated patch section, leave unrelated or minor-version entries
  under `Unreleased`, and update the changelog comparison links.
- For a patch-version-only pull request, skip GitHub CI by default. Do not manually dispatch a
  workflow, and ensure the normal merge commit message itself contains `[skip ci]` as well as its
  DCO sign-off so the push to `main` does not start another workflow run. Use:

  ```bash
  gh pr merge <number> --merge --delete-branch \
    --author-email "$(git config user.email)" \
    --subject "Merge patch release <version> [skip ci]" \
    --body "Signed-off-by: $(git config user.name) <$(git config user.email)>"
  ```

- Do not apply `[skip ci]` to a functional code change merely because the change qualifies as a
  semantic-versioning patch; it is reserved here for the separate version-only patch release.
- For a minor-version release, ask the user whether GitHub CI should be run before proceeding.
- For a major-version release, GitHub CI must be run and pass; do not skip it.
