# Hygiene batch: dependency patches, screenshot audit, seam simplification

Status: agreed 2026-09-06 (revision 2; revision 1 reviewed and revised the same day). Base: `main` at `9bb6440e`, version 0.60.0-alpha.1. Date: 2026-09-06.
Previous batch (maintainability batch 2, PRs #623–#631) is complete; its plan is in git history.

AGENTS.md governs everything not stated here. No build, test or CI reads this file.

## Outcome

Production dependencies are at their latest patch level with a clean production audit, the
documentation screenshots are confirmed current against the last batch, the two contracts that
batch introduced are as small as they can be, and one patch release records it all.

## Rules for the batch

- **Hard exclusions.** No new dependencies, scripts, lint rules, CI workflows or tooling. No minor
  or major dependency updates (`.github/dependabot.yml` states the policy). No change to schemas,
  migrations, fixtures, wire shapes, public `StoreState`, permissions or session policy.
- **Footprint is the contract.** Each task lists its files. An edit outside that list stops the
  task and reports.
- **Stop rule.** Two failed fix attempts on a focused check, or a boundary that cannot preserve a
  listed behaviour, stops the task with the obstacle, files changed and smallest remaining step.
- **Validation.** During implementation: `pnpm exec tsc -b`, `pnpm run lint`, `pnpm exec prettier
--check` on touched files, and the task's focused checks. Before submission: one integration
  worktree merging every finished branch, `pnpm run gate`, `pnpm run gate:server`, `pnpm run e2e`,
  Node >= 24, then the pull requests. Main CI after each merge is the GitHub evidence.
- **Release.** One patch bump at the end (H4). Nothing else in this batch is a release.
- **Done means stop.** When H1–H4 are merged and main is green, tick the completion record.

## Batch briefs

### H1 — Dependency patch bumps

**Facts.** `pnpm outdated -r` at 9bb6440e lists 29 updates: eight majors (`typescript` 7,
`vitest`/`@vitest/coverage-v8` 5, `@types/node` 26, `jsdom` 30, `@testing-library/jest-dom` 7,
two `@stryker-mutator` 10) and nine minors (`better-auth` 1.7.2, `lucide-react`, `eslint`,
`typescript-eslint`, `globals`, `@inlang/paraglide-js`, `@playwright/test`, `playwright-core`,
`@vitejs/plugin-react`), all excluded by policy, and twelve patches. `pnpm outdated` shows only
the newest version, so it hides patches on a current line behind a newer major: the registry
(2026-09-06) also has `vitest` and `@vitest/coverage-v8` 4.1.11 (lockfile 4.1.10) and `@types/node`
24.13.3 (lockfile 24.13.2); every other excluded package is already at the last patch of its
current line. One listed patch is excluded: `@inlang/plugin-m-function-matcher` 2.2.13 declares `@inlang/sdk` 3.0.3 (npm
registry) while the lockfile resolves `@inlang/sdk` 2.10.2, a transitive major; the same bump was
dropped from Dependabot PR #450 in August for that reason. `pnpm audit --prod` at 9bb6440e reports
two moderate fastify advisories (GHSA-w2qp-rph6-63g4, GHSA-3m5p-2c4r-xxw2), both patched at

> =5.12.1; `gate:deps` (`package.json:69`) audits at level high, which is why main is green.
> Dependabot PR #617 (16 updates, based on 0.59.1) is stale: jose 6.2.10 and fastify 5.12.1 where
> 6.2.12 and 5.12.3 are current, and it carries the `@inlang/sdk` 3 pull. Dependabot PRs
> #481–#484 bump `github/codeql-action` (init, analyze, upload-sarif) 4.37.6→4.37.9 and
> `anchore/sbom-action` 0.24.0→0.24.2, all patch, all MERGEABLE CLEAN. `better-auth` 1.6.30 is the
> last 1.6.x release. AGENTS.md: a schema-affecting Better Auth upgrade also bumps
> `DB_SCHEMA_VERSION`; a patch that changes no auth DDL does not.

**Change.** Bump exactly these fourteen, in every manifest that declares them, then
`pnpm install` to refresh the lockfile: root `package.json` — `react-router-dom` ^7.18.3,
`@inlang/plugin-message-format` 4.4.4, `@testing-library/react` ^16.3.3,
`@testing-library/user-event` ^14.6.7, `@types/react-dom` ^19.2.7, `eslint-plugin-react-refresh`
^0.5.6, `vite` ^8.2.2, `vitest` ^4.1.11, `@vitest/coverage-v8` ^4.1.11, `@types/node` ^24.13.3,
`better-auth` 1.6.30; `server/package.json` — `@fastify/helmet` ^13.1.1, `fastify` ^5.12.3, `jose`
6.2.12, `tsx` 4.23.13, `better-auth` 1.6.30, `@vitest/coverage-v8` ^4.1.11, `@types/node`
^24.13.3; `shared/package.json` — `vite` ^8.2.2, `vitest` ^4.1.11, `@types/node` ^24.13.3. Report
every top-level lockfile resolution that changed; transitive movement inside declared ranges is
acceptable and is reported, not constrained. Better Auth DDL evidence: the installed package
carries no changelog, so before and after the bump run a throwaway script (scratch directory, not
committed) that builds the server's auth in password mode with required MFA (so the two-factor plugin's
tables are included) on a fresh in-memory SQLite database with the existing
`runAuthMigrations` helper and prints `name` and `sql` from `sqlite_master` ordered by name; diff
the two dumps. An empty diff is the evidence that `DB_SCHEMA_VERSION` stays. A non-empty diff
stops the task with the diff in the report. Add to `CHANGELOG.md` → `Unreleased`: a
`Security` entry for the fastify advisories and one `Changed` line for the patch updates.
Orchestrator, after the branch is green: close #617 with a one-line comment naming the
superseding pull request; merge #481–#484 one at a time.

**Files.** `package.json`, `server/package.json`, `shared/package.json`, `pnpm-lock.yaml`,
`CHANGELOG.md`.

**Focused checks.** `pnpm run gate:deps` and `pnpm audit --prod` (must report no
vulnerabilities), `pnpm outdated -r` (must list only the eight majors, nine minors and the excluded
matcher plugin, each at its current-line last patch), `pnpm --filter capacitylens-server exec vitest run src/app.auth.test.ts
src/db.migrate.test.ts`, `pnpm exec vitest run src/account src/components/settings`.

**Done.** Fourteen packages at the stated versions; audit clean; `pnpm outdated -r` shows only the
eighteen excluded entries; auth DDL dump diff empty and `DB_SCHEMA_VERSION` untouched; changelog entries present; #617 closed; #481–#484
merged.

### H2 — Screenshot audit against the batch-2 merges

**Facts.** 46 images under `docs-src/screenshots/flows/`, last modified between 2026-08-09 and
2026-08-20 (newest at bf4ac9fd and c5b4b93d). All 46 predate the four batch-2 merges (1094b19e N1,
8df65297 N3, 050807f9 N5, 8e3d8394 N2), so the `git merge-base --is-ancestor` method in AGENTS.md
flags all 46: a superset. The merge diffs: N1 removed the `dayWidth` prop type and its forwarding
and collapsed the `<DateHeader …>` call to one line, with no className, style, text or geometry
change; N3 kept SecuritySection's JSX and messages unchanged (and
`settings_account_disclosures.jpg` is server-backed, not demo-reachable); N5 changed the store
composition only; N2 changed guide prose, an ESLint comment, an exception reason, `tasks/plan.md`
and regenerated `docs/`, no image. The demo seeds relative to the clock (`src/main.tsx:49`
`seedForCurrentWeek`; `shared/src/data/seed.ts:38–61`), so a live capture never reproduces a
committed image byte-for-byte: dates, the today marker and bar positions move with the week.
Bar packing is deterministic (`src/lib/lanePacking.ts:30–35` breaks ties by id).

**Change.** No file change. The audit is: (a) the classification above; (b) a live check at
9bb6440e, already performed: demo on port 5199, schedule (`/`, 1568×900) and settings overview
(`/settings`, 1920×928) captured with a throwaway Playwright script and compared by inspection
against `schedule.jpg` and `settings_overview.jpg` for everything the seed does not move: sidebar,
header controls, utilisation column, discipline groups, lane structure, bar styling, holiday band,
weekend shading, and the settings cards and toggles. Result: identical in every compared element;
only the seeded week differs. This batch's target is the already-merged batch-2 set; H1 and H3 are not UI changes by
intent (patch-level dependency movement and a type plus a validation-loop rewrite that preserves
behaviour), so no further capture is scheduled for them.

**Files.** None.

**Done.** Completion record carries the classification and the inspection result above.

### H3 — Simplify pass over the N3/N5 seams

**Facts.** `src/account/sessionClient.ts` is 54 lines: `isSessionView` predicate (17–27),
`listSessions` (30–54) with a two-cast envelope narrowing (39–45) and a filter-then-length-compare
row check (47–48). `SecuritySection.loadSessions` (`SecuritySection.tsx:107–127`) is a
four-case switch. `AllocationSliceInternals` (`allocationSlice.ts:13–20`) lists six members as
`StoreInternals["…"]` indexed types; the six-line object literal appears at `useStore.ts:38–45`
and `sliceComposition.test.ts:25–32`.

**Candidates.** A finding never widens or narrows a shared type or contract.

- C1: declare `AllocationSliceInternals` as `Pick<StoreInternals, "guarded" | "addAllocationsImpl"
| "updateOwned" | "assertAllocation" | "findOwned" | "mutate">`. Same six members, same
  signatures, eight lines become three. Author: yes.
- C2: replace the filter-and-count at `sessionClient.ts:47–48` with `rows.every(isSessionView)`
  and return `rows` typed by the guard. Author: yes.
- C3: collapse the envelope narrowing at 39–45 into one typed helper. Author: no; it is not
  clearer.
- C4: anything in `loadSessions`. Author: no; the switch is the contract made visible.

**Change.** Whatever the review agrees, implemented directly by the orchestrator (expected diff
under fifteen lines; no brief). No test edits; no behaviour change. A pass that agrees on no
change is complete.

**Files.** `src/store/slices/allocationSlice.ts`, `src/account/sessionClient.ts`.

**Focused tests.** `pnpm exec vitest run src/account/sessionClient.test.ts
src/components/settings/SecuritySection.test.tsx src/store/slices/sliceComposition.test.ts
src/store/useStore.allocations.test.ts`.

**Done.** Agreed candidates applied, `tsc` clean, the four suites pass with unchanged assertions.

### H4 — Release 0.60.1-alpha.1

After H1, H3, any H2 recapture and #481–#484 have merged and main is green: separate branch and
worktree; `package.json` and `server/package.json` to 0.60.1-alpha.1; move the batch's
`Unreleased` entries into a dated `[0.60.1-alpha.1]` section; add its comparison link and move
the `[Unreleased]` link; pull request title carries `[skip ci]`; no workflow dispatch. Patch
release, so no CI question for the owner. Move only this batch's entries; any unrelated entry
that has landed under `Unreleased` in the meantime stays there. After merging, confirm the head of
`CHANGELOG.md` and that the links resolve.

## Sequence

1. This plan lands first (docs-only pull request, cheap ladder).
2. H1 (delegate, own worktree) and H2 (orchestrator, no worktree) run concurrently.
3. H3 after review agreement, own worktree, directly by the orchestrator.
4. One integration worktree merging H1 and H3; the three validation commands once; then the
   H1 and H3 pull requests, #617 closed, #481–#484 merged, any H2 recapture last.
5. H4.

## Completion record

- [x] Plan agreed (two review rounds, 2026-09-06) and merged: PR #632, merge 129ac8e0.
- [x] H1 merged: PR #633, merge 84976539; fourteen patches, `pnpm audit --prod` clean, auth DDL
      dump diff empty, `DB_SCHEMA_VERSION` unchanged. #617 closed as superseded. #481–#484 merged
      (39dee30f, 4fa12af8, 185ee444, cf8478fc). Integration gate on main 129ac8e0 plus both
      branches, Node 24.16.0: `gate:server` passed, `e2e` 257 passed, `gate` 3717 tests passed.
- [x] H2 classification and inspection recorded (live check at 9bb6440e, 2026-09-06).
- [x] H3 merged: PR #634, merge 382dcbb3; C1 and C2 applied, C3 and C4 declined, no test edits.
- [x] Main CI on 382dcbb3 green on all six workflows (gate, e2e, docker, security, CodeQL, Scorecard).
      H4: release 0.60.1-alpha.1 in this pull request, `[skip ci]`, patch release. Stopped.
