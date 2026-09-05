# Maintainability batch 2: four small boundaries

Status: agreed 2026-09-05 (revision 3; revision 1 is d1728858, review in `plan-review.md`,
consensus record in `plan-consensus.md`). Owner accepted the integration-validation bullet. Base: `main` at `c0a6eb54`, version 0.60.0-alpha.1.
Date: 2026-09-05.

AGENTS.md governs everything not stated here. This file adds only the batch, its rules and its
briefs. No build, test or CI reads this file.

## Outcome

A contributor changing one behaviour reads its implementation, one small explicit contract and
the focused tests, and nothing else. This batch removes one piece of misleading wiring, corrects
the guide that still advertises deleted tooling, and gives two behaviours an explicit contract.
It preserves visible behaviour. It adds no tooling.

## Rules for the batch

- **Hard exclusions.** No new dependencies, scripts, lint rules, scanners, budgets, ledgers,
  CI workflows, docs tests or generic frameworks. No change to schemas, migrations, fixtures, wire
  shapes, stable ids, public `StoreState`, permissions, session policy or scheduling maths.
- **Footprint is the contract.** Each brief lists its files. An edit outside that list stops the
  task and reports; it does not widen the task.
- **Stop rule.** Two failed fix attempts on a focused test, or a boundary that cannot preserve a
  listed behaviour, stops the task with the obstacle, files changed and smallest remaining step.
  Preserve every existing behavioural assertion; the only permitted test edits are the typed-prop
  and mock changes each brief names.
- **Validation during implementation.** `pnpm exec tsc -b`, `pnpm run lint`, `pnpm exec prettier
  --check` on touched files, and the brief's focused tests via `pnpm run paraglide:compile && pnpm
  exec vitest run <paths>`. Nothing is rerun for reassurance.
- **Validation before submission.** AGENTS.md requires the complete validation commands before a
  pull request is submitted. This batch satisfies that once for the four disjoint tasks: merge the
  four finished branches into a throwaway integration worktree, run `pnpm run gate`,
  `pnpm run gate:server` and `pnpm run e2e` there, sequentially, Node >= 24, one Playwright process
  on the machine, and only then open the pull requests. A task that changes after that run is
  re-integrated and the three commands run again. Main CI after each merge is the GitHub evidence;
  a red main is fixed forward before the next merge lands.
- **Owner decision required.** The integration run above is how the repository's August batches
  were validated, but AGENTS.md's batch section does not yet say so. The pull request that lands
  this plan adds one bullet there: "Disjoint pull requests in one batch may be validated once, on
  their integrated tree, before any of them is submitted; main CI validates each merge." If the
  owner declines, every pull request runs the three commands itself and the rest of this plan
  stands.
- **Delivery.** One branch, worktree and PR per task; signed commits; normal merge; verify PR,
  merge SHA, workflow outcomes and branch deletion. N1, N3 and N5 are disjoint and may be
  implemented in parallel. N2 commits generated `docs/`, so it merges last, after the three code
  tasks, per AGENTS.md's generated-assets rule.
- **Release.** None unless the owner asks. If asked, one bump at the end of the batch, per
  AGENTS.md's version rules.
- **Done means stop.** When N1, N2, N3 and N5 are merged and main is green, tick the completion
  record and stop. Later options are selected one at a time, by the owner.

## Batch briefs

### N1 — Remove the unread `dayWidth` prop from DateHeader and ResourceLane

**Facts.** `DateHeader.tsx:53` and `ResourceLane.tsx:92` declare `dayWidth` and never read it
(the other DateHeader occurrence, line 70, is a comment). The ResourceLane comment at lines 89–91
already says to drop it together with its caller. Forwarders: `SchedulerGrid.tsx:173,238`,
`SchedulerGridRows.tsx:79`, `SchedulerGridRow.tsx:32,182` (`dayWidth: LaneProps["dayWidth"]`),
`SchedulerGridHeader.tsx:69`. Real width maths lives in `useSchedulerViewport.ts`,
`columnGeometry.ts` and `schedulerConfig.ts` and is untouched.

**Change.** Delete the prop from both props types, delete only the forwarding that becomes unused,
delete the two "declared but not read" comments, and update the typed test props at
`DateHeader.test.tsx:16,102,171` and `ResourceLane.test.tsx:77,111`.

**Files.** `src/components/scheduler/{DateHeader,ResourceLane,SchedulerGrid,SchedulerGridRows,
SchedulerGridRow,SchedulerGridHeader}.tsx` and `{DateHeader,ResourceLane,SchedulerGrid}.test.tsx`.

**Focused tests.** `DateHeader.test.tsx`, `ResourceLane.test.tsx`, `SchedulerGrid.test.tsx`,
`SchedulerGrid.identity.test.tsx`, `drawModeRerender.test.tsx`. No new tests.

**Done.** Neither component declares or receives the prop; `tsc` is clean; the five suites'
behavioural assertions are unchanged and pass. Stop if any deleted value turns out to feed
geometry or timing.

### N2 — Correct the development guide and the primitive-ownership wording

**Facts.** `docs-src/reference/development.md:154` promises a naming-enforcement programme and
lines 399–448 document `policy:function-budgets`, a 600-line test ceiling, `tasks/todo.md`
exceptions and "T15"; the script, ceiling and ledger no longer exist (`package.json` scripts,
`scripts/`). The three adapter type imports are pinned by
`server/src/accounts/conformance/architecture.test.ts`, not by a ledger.
`server/src/documentation.test.ts:41–46` requires every backticked `scripts/*.mjs|js|ts` path in
the guide to exist and at least one to remain (lines 306 and 841 already qualify).
`scripts/file-size-exceptions.json:6` and `eslint.config.js:153–155` call the sidebar primitive
"generated"; AGENTS.md:129 and DECISIONS.md:341 call `src/components/ui/*` source-owned.
The actual check (`scripts/check-file-sizes.mjs`) scans 592 tracked production TS/TSX files under
`src`, `server/src`, `shared/src`, ceiling 400, excludes tests, `.d.ts`, `src/paraglide` and `e2e`,
one permanent sidebar exception, and prints an unenforced "approximately N lines" function diagnostic.

**Change.** Describe the actual check; remove the function-budget commands, the test ceiling, the
`tasks/todo.md` references and the naming-enforcement promise; say the adapter imports are pinned
by the conformance test. Keep the import-cycle (line 434), account-ownership (line 443) and
environment guidance. Change the exception `reason` and the ESLint comment from "generated" to
"source-owned shadcn primitive"; no lint behaviour or exception semantics change. Then
`pnpm run docs:build` and commit `docs/`.

**Files.** `docs-src/reference/development.md`, `scripts/file-size-exceptions.json`,
`eslint.config.js`, generated `docs/**`.

**Focused tests.** `pnpm --filter capacitylens-server exec vitest run src/documentation.test.ts`,
`pnpm run policy:file-sizes`. Open the rebuilt development page and read the edited section. No
screenshots change.

**Done.** The guide names only commands that exist in `package.json`; primitive wording matches
AGENTS.md; docs rebuilt. Do not fix unrelated docs issues seen on the way.

### N3 — Typed session-list result from the account client

**Facts.** `accountClient.listSessions()` returns `Promise<Response>` (`accountClient.ts:34–38`)
through the shared `apiFetch` timeout, credentials and audit-warning path. Its only production
caller, `SecuritySection.tsx:114–159`, parses the envelope (non-array object with array
`sessions`), validates rows with `isAccountSessionId`, finite `Date.parse` on `createdAt`, nullable
finite `expiresAt` and boolean `current`, and returns `"loaded" | "unauthorized" | "failed" |
"superseded"`: 401 is `"unauthorized"` regardless of body; other non-OK, unreadable body and
malformed envelope are `"failed"` with `err_sessions_load`; any bad row rejects the whole list with
`err_sessions_invalid`; an empty list loads; transport errors are logged and mapped to
`err_sessions_load`; a stale generation returns `"superseded"` before any UI effect.

**Change.** New `src/account/sessionClient.ts` exporting `SessionView` and
`listSessions(): Promise<SessionListResult>` where
`SessionListResult = { kind: "loaded"; sessions: SessionView[] } | { kind: "unauthorized" } |
{ kind: "failed" } | { kind: "invalid" }`. It calls the existing `apiFetch` and moves the envelope
check and row predicate out of SecuritySection verbatim. `"failed"` covers other non-OK, unreadable
body, malformed envelope and thrown transport error (logged, not rethrown). SecuritySection maps
`"invalid"` to `err_sessions_invalid`, the other two failures to `err_sessions_load`, and keeps the
generation check and `"superseded"` outcome, since only it knows which request is current. Remove
`accountClient.listSessions` once nothing calls it.

**Files.** `src/account/sessionClient.ts` (new), `src/account/accountClient.ts`,
`src/components/settings/SecuritySection.tsx`, `SecuritySection.test.tsx` (mocks move from
`Response` to `SessionListResult`, line 20 onward), `src/account/sessionClient.test.ts` (new,
holds the moved payload cases only).

**Focused tests.** `src/account/accountClient.test.ts`, `src/account/sessionClient.test.ts`,
`src/components/settings/SecuritySection.test.tsx`. The eleven password/session integration cases
at `SecuritySection.test.tsx:155–378` (stale post-password request, current-session revoke,
unknown outcomes, failed list, invalid list not rendering its valid subset, transport reconcile)
stay as integration proof with their assertions intact. Add a client case only where the moved
predicate has no assertion of its own.

**Done.** SecuritySection contains no JSON parsing or row predicate for sessions; every outcome
above is asserted somewhere once; no `Response` leaks through the new function. Stop if the change
wants to touch provider links, invitations, command outcomes or the server.

### N5 — Pass the allocation slice only what it uses

**Facts.** `createAllocationSlice(internals: StoreInternals)` (`allocationSlice.ts:13`)
destructures exactly six members at line 15: `guarded`, `addAllocationsImpl`, `updateOwned`,
`assertAllocation`, `findOwned`, `mutate`. Their signatures are declared in
`storeInternal.ts:32,75,98,124` and `storeGuards.ts:60,62`. Composition points:
`useStore.ts:38` and `sliceComposition.test.ts:25`.

**Change.** Define `AllocationSliceInternals` beside `createAllocationSlice` as an explicit
interface of those six members with their existing signatures. Change the parameter type and pass
an object literal of the six function references from `useStore.ts`. No wrappers, no
`Pick<StoreInternals, …>` while still passing the whole object, no change to other slices or to
`StoreInternals` itself. If a signature cannot be named without editing `StoreInternals`, stop and
report.

**Files.** `src/store/slices/allocationSlice.ts`, `src/store/useStore.ts`,
`src/store/slices/sliceComposition.test.ts`. Read-only: `storeInternal.ts`, `storeGuards.ts`.

**Focused tests.** `src/store/useStore.allocations.test.ts`, `useStore.crud.test.ts`,
`useStore.undoSync.test.ts`, `useStore.tenancy.test.ts`, `slices/sliceComposition.test.ts`.

**Done.** The slice's parameter type lists six members; `tsc` proves the composition; all listed
suites' assertions are unchanged and pass.

## Later options (not selected; each needs a brief written against the base at that time)

- **N4 — session behaviour owner.** After N3. Contract, decided now so selection is a yes/no:
  `useSecuritySessions({ onError, onClear, onNotice })` returning `{ sessions, refresh, revoke }`;
  `SecuritySessions.tsx` renders rows from `{ sessions, busy, onRevoke }`; busy stays in
  SecuritySection by wrapping `revoke`; password success still awaits `refresh`. Files:
  SecuritySection, the two new files, existing SecuritySection tests. Select only if a session
  change is actually wanted.
- **N6 — lane drawing hook.** After N1. `useLaneDrawing` owns the lane ref, client-X lookup,
  gesture state and listener cleanup (`ResourceLane.tsx:126–169` today); rendering layers stay in
  ResourceLane. Preserve the pointer cases in `ResourceLane.test.tsx`, `drawModeRerender.test.tsx`
  and `AllocationBar.interaction.test.tsx`; run the gesture specs in `e2e/scheduler.spec.ts` and
  `e2e/features.spec.ts` on all three configured browsers.
- **N7 — one persistence transition.** Give the write-failure/retry updates in
  `attachmentState.ts` (`update(patch)` at line 76, mutated from `writeQueue.ts:51,98,114,116`) a
  named operation. Brief must enumerate exact fields, callers and the tests in `persist.test.ts`,
  `persist.overlap.test.ts`, `ImportExport.persistence.test.tsx` and `e2e/persistence.db.spec.ts`
  before any edit.
- **N8 — typed import stage.** Pass typed rows through one stage of `importFold.ts`, preferably
  allocation relationship repair (line 222, after sanitisation and parent repair), removing that
  stage's `as unknown as` casts. Tests: `shared/src/domain/mutations.test.ts`,
  `shared/src/lib/{sanitizeImport,integrity}.test.ts`, `src/store/importHardening.test.ts`, import
  scenarios in `server/src/app.test.ts`.

Retired for good: naming/import enforcement, function budgets, exception ledgers, blanket test
splitting, docs tooling. Revisit only for a recurring defect that review cannot catch.

## Completion record

- [x] Plan agreed; owner accepted the AGENTS.md batch-validation bullet; historical process
      documents (`tactical-plan.md`, `consensus-log.md`, `recovery-plan-review.md`) removed from
      `tasks/`.
- [ ] Integration run of the three commands: revision and result.
- [ ] N1 merged: PR, merge SHA, main CI result.
- [ ] N3 merged: PR, merge SHA, main CI result; moved vs new test cases listed.
- [ ] N5 merged: PR, merge SHA, main CI result.
- [ ] N2 merged last: PR, merge SHA, main CI result.
- [ ] Stopped.
