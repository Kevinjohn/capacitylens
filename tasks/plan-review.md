# Adversarial review of `tasks/plan.md` (revision d1728858)

Reviewer: Claude. Date: 2026-09-05. Every claim below was checked against `main` at `c0a6eb54`.
Verdict: **the substance is right, the wrapping is the same failure mode as the last programme.**
The previous run over-built tooling; this draft over-builds process prose. Four small tasks do
not need 344 lines, four gates, nine cost-control rules, ten review questions and a thirteen-row
deferral table. Nothing in that wrapping is executable, so none of it can stop a run going off
the deep end; it only costs reading time and drifts from AGENTS.md.

## A. What the fact-check confirmed (keep)

| Claim | Evidence |
| --- | --- |
| N1: `dayWidth` declared and never read in DateHeader and ResourceLane | `DateHeader.tsx:53` (comment at 52 says unread; line 70 is a comment, not a read). `ResourceLane.tsx:89–92` comment says "drop both together". Forwarders: `SchedulerGrid.tsx`, `SchedulerGridRows.tsx`, `SchedulerGridRow.tsx:32` (`dayWidth: LaneProps["dayWidth"]`), `SchedulerGridHeader.tsx`. Tests: `DateHeader.test.tsx`, `ResourceLane.test.tsx`, `SchedulerGrid.test.tsx`. |
| N3: `listSessions()` returns `Promise<Response>`; SecuritySection decodes | `accountClient.ts:34–38`; `SecuritySection.tsx:114–149`. Sole production caller is `SecuritySection.tsx:118`. |
| N3 outcome categories | Current code returns `"unauthorized"` on 401, `"failed"` on other non-OK **and** on a malformed envelope (same message `err_sessions_load`), `"failed"` with `err_sessions_invalid` on bad rows, `"superseded"` on stale generation. Transport errors are caught and mapped to `err_sessions_load`. The plan's three-way split matches this. |
| N5: allocation slice consumes exactly six internals | `allocationSlice.ts:15` destructures `guarded, addAllocationsImpl, updateOwned, assertAllocation, findOwned, mutate` from `StoreInternals`. |
| N2: the guide documents deleted machinery | `development.md:399–411, 421, 427, 447–448` (`policy:function-budgets`, `tasks/todo.md`, T15, 600-line test ceiling). No such script exists in `package.json`. `file-size-exceptions.json` reason is `"shadcn-generated"`; `eslint.config.js:153–155` says "Generated shadcn/ui primitives". |
| N7/N8 gaps exist | `attachmentState.ts:76` `update(patch: Partial<…>)`; `importFold.ts` has 11 `as unknown as` and 10 `Record<string, unknown>`. |
| All cited test files exist | Four were cited at the wrong directory (`sliceComposition`, `importHardening`, `integrity`, `sanitizeImport`); paths corrected in the rewrite. |

## B. Factual errors in the draft (fix)

1. **Line counts are a muddle of two different measurements.** The draft mixes file length and the
   checker's "approximate function span" without saying which. Actual `wc -l`: SecuritySection 376
   (draft: ~346), ResourceLane 399 (draft: 336), SchedulerGrid 300 (266), importFold 315 (270),
   workspaceLifecycle 371 (352), useAllocationGesture 378 (335). None of these numbers drive a
   decision, so the rewrite drops them.
2. **"No docs tests touch N2" is false in one place.** `server/src/documentation.test.ts:41` pins
   every backticked `scripts/*.mjs|js|ts` path in `development.md` to an existing file and requires
   at least one such path to remain. The N2 brief must say so, and the N2 validation must run that
   one test. The draft's proposed N2 exception (formatter + docs build only) would skip it.
3. **"The previous tactical plan's named-spec-only exception"** is described as if it were repo
   policy. It never was: `AGENTS.md` and `DECISIONS.md` contain no such rule. The rewrite states
   the batch validation rule once, from AGENTS.md's own batch section.
4. **The N2 brief asks for a sentence about "retained adapter type exceptions … T15".** The three
   adapter imports are enforced by `server/src/accounts/conformance/architecture.test.ts`, not by
   a task ledger. Say that instead of inventing new prose about their "current role".

## C. Structural problems (the deep end, in prose form)

1. **Gates A–D restate AGENTS.md.** Worktree from `origin/main`, focused tests during work, full
   diff review, signed commits, `gh` PR, normal merge, verify, clean up: every line is already
   repository policy. A second copy will drift. Replace with one line: "AGENTS.md governs;
   the only additions are below."
2. **Cost control 6 (45/90-minute checkpoints) is unowned and unmeasurable.** Nobody times a
   delegate. Replace with the mechanical rule the last plan already used: two failed fix attempts
   on a focused test, or any edit outside the listed footprint, stops the task and reports.
3. **The validation stance is over-testing, which is what the owner is complaining about.**
   Section 7 demands `gate`, `gate:server` and the full `e2e` suite per PR, and explicitly rejects
   "full gates once per batch". For N1 (delete a prop) that is roughly 25 minutes of Playwright
   per PR for zero information: main CI runs all six workflows on every merge anyway, there are no
   users (a red main for an hour costs nothing), and AGENTS.md's batch section plus the repo's own
   batch history (`issue-batch-2026-08-17`) already validate a batch as one integration. Rule in
   the rewrite: per PR, the cheap ladder (`tsc`, `lint`, `prettier --check`, focused vitest);
   once per batch, the three full commands on the integrated tree before the last merge; main CI
   after every merge is the GitHub evidence. The N2 "exception" then needs no separate decision.
4. **N4 is a menu, not a decision.** "The hook may receive the small set of feedback callbacks it
   actually uses"; "if the contract becomes a dependency bag, revise the boundary". That is exactly
   the open design that burns delegate rounds. Reading the code: the session logic uses `fail`,
   `clear`, `setMessage`, `setBusy`, `reloadPage` and `sessions`. Pinned contract in the rewrite:
   `useSecuritySessions({ onError, onClear, onNotice })` returning `{ sessions, refresh, revoke }`;
   busy stays in the parent by wrapping `revoke`. Three callbacks, no setters passed through.
   With that pinned, N4 is briefable. Without it, it is not.
5. **N4 should not be in the first batch.** After N3, SecuritySection is about 340 lines under a
   400 cap and covered by eleven integration tests that all exercise the real composition. N4 moves
   about 130 lines into two files for a benefit nobody has yet asked for. N5 delivers the same
   "smaller explicit contract" lesson in three files, verified by the compiler, at a fraction of
   the risk. Recommended first batch: **N1, N2, N3, N5.** N4 becomes the first later option, with
   its contract pinned now so selecting it later is a one-line decision.
6. **Sections 2, 6, 8 and 9 are 150 lines about work that is not selected.** The F/M/T
   reconciliation table, the 60-line briefs for N5–N8, the deferral table and the ten review
   questions belong in this review or in the consensus log, not in the living plan. Later options
   get three lines each: gap, boundary, footprint. Their brief is written when selected, against
   the base at that time.
7. **`tasks/` now carries 180 KB of process history** (`consensus-log.md`, `tactical-plan.md`,
   `recovery-plan-review.md`, the old `plan.md`). The draft says historical plans are "evidence,
   not instructions". Then they do not need to sit next to the live plan. Owner decision: delete
   them on the branch that lands the new plan, or move them under `tasks/history/`. The rewrite
   assumes deletion of `tactical-plan.md`, `consensus-log.md` and `recovery-plan-review.md`, since
   every one of them is in git history at `d1728858`.

## D. Required changes, in one list

1. Replace `plan.md` with the rewrite in this branch (target under 170 lines).
2. First batch is N1, N2, N3, N5. N4 moves to later options with the pinned contract.
3. Validation: cheap ladder per PR, three full commands once on the integrated batch, main CI is
   the evidence. No per-task exceptions to decide.
4. Stop rules are mechanical: two failed fix attempts or an edit outside the footprint.
5. N2 brief names `documentation.test.ts` and keeps at least one backticked script path.
6. No release unless the owner asks; if asked, one patch at the end.
7. Delete the historical process documents from `tasks/`.

## E. What I did not object to

The hard-exclusions list (section 3) is right and short enough to keep verbatim. The stop
conditions inside N1 and N3 are good. "Reject the whole list if any row is invalid" and "stale
generation checks stay in the UI owner" are correct readings of the current code. The eleven
SecuritySection tests and the five scheduler tests named for N1 are real and sufficient.
