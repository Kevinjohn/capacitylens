# Consensus record: maintainability batch 2 plan

Date: 2026-09-05. Base `c0a6eb54`. Reviewer A drafted revision 1 (d1728858); Reviewer B reviewed it (`plan-review.md`) and rewrote it; two rounds reached AGREED. Open owner decision: the AGENTS.md batch-validation bullet (see `plan.md` → Rules → Owner decision required).

---

# Round 1 — Reviewer A response to the review and rewrite

## Fact-check of Reviewer B

- CONFIRMED — The tracked code matches `c0a6eb54`; the tracked diff is only `tasks/plan.md`. Both package versions are `0.60.0-alpha.1` (`package.json:4`, `server/package.json:4`).
- WRONG — The original is 343 lines, not 344, and its deferral table has 12 data rows, not 13 (`d1728858:tasks/plan.md:294`). The rewrite is 182 lines, exceeding its own review's under-170 target (`tasks/plan-review.md:85`, `tasks/plan.md:182`).
- CONFIRMED — The original contains four named gates, nine cost controls and ten review questions (`d1728858:tasks/plan.md:75`, `:254`, `:315`).
- WRONG — Original sections 2, 6, 8 and 9 total 131 lines, not 150; section 2 also discusses selected work, not only unselected work (`d1728858:tasks/plan.md:26`, `:182`, `:294`, `:311`).
- CONFIRMED — No build/test/CI reference to the living plan was found in scripts, workflows or source; the file-size inventory only selects source roots (`scripts/check-file-sizes.mjs:40`).
- CONFIRMED — DateHeader declares but never reads `dayWidth`; its other occurrence is a comment (`src/components/scheduler/DateHeader.tsx:52`, `:53`, `:70`).
- CONFIRMED — ResourceLane declares but never reads `dayWidth`, and explicitly requests removing it with the caller (`src/components/scheduler/ResourceLane.tsx:64`, `:89`, `:92`).
- CONFIRMED — All four forwarding files exist and forward this value; the indexed type is real (`src/components/scheduler/SchedulerGrid.tsx:173`, `:238`, `SchedulerGridRows.tsx:79`, `SchedulerGridRow.tsx:32`, `:182`, `SchedulerGridHeader.tsx:69`, all in that directory).
- CONFIRMED — N1's actual prop-bearing test calls are within its footprint (`src/components/scheduler/DateHeader.test.tsx:16`, `:102`, `:171`, `ResourceLane.test.tsx:77`, `:111`); no additional direct component caller requiring an edit was found.
- CONFIRMED — The five N1 suites exist and exercise layout, geometry, identity, drawing and draw-mode rendering (`src/components/scheduler/DateHeader.test.tsx:27`, `ResourceLane.test.tsx:192`, `SchedulerGrid.test.tsx:60`, `SchedulerGrid.identity.test.tsx:22`, `drawModeRerender.test.tsx:55`).
- CONFIRMED — Real width calculations must remain in viewport/geometry/config (`src/components/scheduler/useSchedulerViewport.ts:139`, `columnGeometry.ts:90`, `src/lib/schedulerConfig.ts:97`). AllocationBar's `dayWidth` occurrence is only a comment (`src/components/scheduler/AllocationBar.tsx:96`).
- CONFIRMED — `accountClient.listSessions()` returns `Promise<Response>` and has one production browser caller (`src/account/accountClient.ts:34`, `src/components/settings/SecuritySection.tsx:118`).
- CONFIRMED — Session requests use credentials and the shared timeout/audit-warning path (`src/account/accountClient.ts:35`, `src/data/requestTimeout.ts:20`, `:61`, `:66`, `:69`).
- CONFIRMED — The envelope must be a non-array object with an array-valued `sessions`; unreadable JSON becomes a failed envelope (`src/components/settings/SecuritySection.tsx:119`).
- CONFIRMED — HTTP 401 yields unauthorized regardless of body; other non-OK responses and malformed envelopes yield failed with the load error (`src/components/settings/SecuritySection.tsx:127`).
- CONFIRMED — Rows require a valid session ID, parseable finite date strings, nullable expiry and boolean current (`src/components/settings/SecuritySection.tsx:132`). “Finite createdAt” means finite `Date.parse`, not a numeric timestamp.
- CONFIRMED — Any invalid row rejects the entire list with the invalid-list message; an empty valid list loads successfully (`src/components/settings/SecuritySection.tsx:144`, `:150`).
- CONFIRMED — Transport exceptions are logged and map to the load error; stale outcomes return superseded before UI effects (`src/components/settings/SecuritySection.tsx:128`, `:145`, `:149`, `:153`). The cited 114–149 range omits successful completion and the catch; the function ends at 159.
- CONFIRMED — Unmount invalidates outstanding loads, and password success awaits refresh (`src/components/settings/SecuritySection.tsx:161`, `:202`). These remain expressible with the proposed N3/N4 ownership.
- CONFIRMED — Current-session success and uncertain current-session revocation reload; uncertain other-session revocation refreshes and reloads on unauthorized (`src/components/settings/SecuritySection.tsx:222`, `:239`).
- CONFIRMED — Session logic consumes fail, clear, notice state, busy state, reloadPage and sessions; the parent can retain busy ownership around an awaited revoke (`src/components/settings/SecuritySection.tsx:37`, `:129`, `:151`, `:222`, `:239`, `:265`). No incompatible dependency was found in N4's three-callback boundary.
- CONFIRMED — There are eleven password/session integration cases at `src/components/settings/SecuritySection.test.tsx:155` through `:378`; the whole file has sixteen cases, including provider/localization cases beginning at `:76`.
- CONFIRMED — The specifically cited stale-load, current-revoke, uncertain-revoke, failed-list, invalid-subset and transport-reconcile assertions exist (`src/components/settings/SecuritySection.test.tsx:195`, `:230`, `:252`, `:327`, `:334`, `:378`).
- CONFIRMED — `src/account/accountClient.test.ts` exists and tests wrapped requests and audit-warning wiring (`:65`, `:83`). It contains no listSessions caller that must change; the component mock does (`src/components/settings/SecuritySection.test.tsx:20`). The session-client files are explicitly proposed new files, not missing existing tests.
- CONFIRMED — AllocationSlice consumes exactly the six named internals (`src/store/slices/allocationSlice.ts:13`, `:15`); the production and test composition points are covered by N5's footprint (`src/store/useStore.ts:38`, `src/store/slices/sliceComposition.test.ts:25`).
- CONFIRMED — The existing signatures can be named without changing StoreInternals or public entities (`src/store/storeInternal.ts:32`, `:75`, `:98`, `:124`, `src/store/storeGuards.ts:60`, `:62`). Direct function references preserve the existing closures.
- CONFIRMED — All five N5 suites exist: `src/store/useStore.allocations.test.ts:1`, `useStore.crud.test.ts:1`, `useStore.undoSync.test.ts:1`, `useStore.tenancy.test.ts:1`, and `slices/sliceComposition.test.ts:1`, relative to `src/store/`.
- CONFIRMED — The guide still advertises deleted function-budget commands, the test ceiling and task-ledger entries (`docs-src/reference/development.md:399`, `:406`, `:411`, `:421`, `:427`, `:447`); no function-budget script exists in `package.json:28` through `:82`, and `tasks/todo.md` is absent.
- CONFIRMED — The naming-enforcement promise is real, but outside N2's approximate line range: `docs-src/reference/development.md:154`. Import-cycle/account-ownership guidance is at `:434` and `:443`.
- CONFIRMED — The existing documentation test checks all matching backticked script paths and requires a nonempty set (`server/src/documentation.test.ts:41`, `:45`, `:46`). Existing valid paths already remain at `docs-src/reference/development.md:306` and `:841`.
- WRONG — The original never says “No docs tests touch N2”; it explicitly retains existing documentation tests (`d1728858:tasks/plan.md:67`). Its proposed N2 validation nevertheless omits the relevant test (`:284`), so B's practical correction is sound.
- CONFIRMED — The three adapter type edges are enforced by tests, not a task ledger (`server/src/accounts/conformance/architecture.test.ts:62`, `:409`). T15 remains in that live test's name/comment; “none of which exist” should mean the deleted task programme, not absence of that identifier (`tasks/plan.md:53`).
- CONFIRMED — Exception reason and ESLint comments say generated; repository ownership guidance says source-owned (`scripts/file-size-exceptions.json:6`, `eslint.config.js:153`, `AGENTS.md:129`, `DECISIONS.md:341`). Changing the reason/comment does not change their enforcement (`scripts/check-file-sizes.mjs:14`, `eslint.config.js:158`).
- CONFIRMED — Read-only inventory filtering yields 592 tracked production TS/TSX files; declarations, test/spec files, Paraglide and e2e are excluded (`scripts/check-file-sizes.mjs:39`). The cap is 400, with one permanent sidebar exception and no temporary exceptions (`scripts/file-size-exceptions.json:2`).
- CONFIRMED — Approximate function spans are informational and cannot fail the file cap (`scripts/check-file-sizes.mjs:60`, `:78`, `:90`, `:99`).
- CONFIRMED — B's physical file lengths are correct: SecuritySection 376, ResourceLane 399, SchedulerGrid 300, importFold 315, workspaceLifecycle 371, useAllocationGesture 378 (respective final lines; lifecycle is `server/src/accounts/flows/workspaceLifecycle.ts`, gesture is `src/components/scheduler/useAllocationGesture.ts`).
- WRONG — The draft did identify approximate/original spans and distinguish them from the checker; B's “without saying which” overstates the problem (`d1728858:tasks/plan.md:51` through `:55`). Deleting those numbers is still useful.
- CONFIRMED — N7's generic partial update exists (`src/data/persistence/attachmentState.ts:76`); write failure and retry mutate it directly (`src/data/persistence/writeQueue.ts:51`, `:98`, `:114`, `:116`).
- CONFIRMED — N7's four test paths exist and contain relevant persistence scenarios (`src/data/persist.test.ts:250`, `src/data/persist.overlap.test.ts:42`, `src/components/ImportExport.persistence.test.tsx:88`, `e2e/persistence.db.spec.ts:44`).
- CONFIRMED — importFold contains eleven executable `as unknown as` casts, plus one comment occurrence, and ten `Record<string, unknown>` occurrences (`shared/src/domain/importFold.ts:60`, `:133`, `:225` through `:294`). Its allocation-repair stage follows sanitization and parent repair (`:131`, `:139`, `:222`).
- CONFIRMED — All N8 test paths exist and contain relevant cases (`shared/src/domain/mutations.test.ts:1130`, `shared/src/lib/sanitizeImport.test.ts:14`, `shared/src/lib/integrity.test.ts:1`, `src/store/importHardening.test.ts:1`, `server/src/app.test.ts:1728`).
- WRONG — The four supposedly corrected original test directories were already correct at `d1728858:tasks/plan.md:192` and `:240`; they match the working-tree paths above.
- CONFIRMED — ResourceLane owns refs, geometry lookup, drawing state and document listener cleanup (`src/components/scheduler/ResourceLane.tsx:126`, `:141`, `:169`). The proposed later hook can retain these without moving rendering layers.
- CONFIRMED — N6's named interaction suite exists and tests cancellation/cleanup (`src/components/scheduler/AllocationBar.interaction.test.tsx:1264`); actual browser gesture specs exist (`e2e/scheduler.spec.ts:138`, `e2e/features.spec.ts:155`). Chromium, WebKit and Firefox projects are configured (`playwright.config.ts:85`, `:134`, `:146`).
- CONFIRMED — Every named current package script exists: compile, lint, docs:build, policy:file-sizes, gate, gate:server and e2e (`package.json:29`, `:38`, `:46`, `:52`, `:61`, `:70`, `:74`); tsc, prettier and vitest are installed command dependencies (`:128`, `:130`, `:134`). The server filter name matches (`server/package.json:2`).
- CONFIRMED — Docs rebuilding/committing, Node >=24, isolated worktrees, signed commits, PR review, normal merge and cleanup already come from AGENTS.md (`:8`, `:22`, `:146`, `:165`, `:213`, `:218`, `:223`).
- WRONG — AGENTS.md's batch section does not authorize full validation only once at batch end; it permits parallel disjoint work (`AGENTS.md:40`) while retaining complete validation before submission (`:165`, `:208`).
- WRONG — The original does not present the earlier named-spec exception as standing policy: it explicitly limits it to the earlier batch (`d1728858:tasks/plan.md:252`). Neither AGENTS.md nor DECISIONS.md grants that exception to this batch.
- CONFIRMED — The historical plan contains both a failed-verification stop rule and a named-spec-only E2E instruction (`tasks/tactical-plan.md:37`, `:39`); the latter was actual historical text, not an invented exception.
- CONFIRMED — The six general workflows trigger on main pushes: `.github/workflows/{gate,e2e,docker,security,codeql,scorecard}.yml` (push declarations at `:10`, `:5`, `:5`, `:5`, `:5`, `:4` respectively). Docs additionally has path filters (`.github/workflows/docs.yml:6`); release provenance uses release/dispatch (`release-provenance.yml:3`).
- WRONG — B's 25-minute/no-users/zero-cost justification is unsupported as verified evidence, not disproved: no local timing or deployment evidence establishes those assertions (`tasks/plan-review.md:51`). The named `issue-batch-2026-08-17` precedent was not found in local files, refs or commit-message history; it cannot establish policy here.
- CONFIRMED — Approximately 180 KB of historical material is accurate for the original revision: the four files total 183,716 bytes and all exist in `d1728858` (`tasks/{plan,consensus-log,tactical-plan,recovery-plan-review}.md:1`). No executable reference requiring the three historical documents was found.
- CONFIRMED — No release is inherently required by these refactors; one requested release per batch matches policy, with separate minor/major rules still applying (`AGENTS.md:230`, `:231`, `:241`).

## Dispositions of the seven required changes (plan-review.md section D)

1. AGREE — Replace the long draft with the lean rewrite after the two blocking policy contradictions below are corrected; no defense of the discarded process prose.
2. AGREE — Select N1, N2, N3 and N5; defer N4 with the proposed contract. I found no behaviour that requires N4 in this batch.
3. DISAGREE — As written, early PRs can be submitted and merged without the complete validation required by `AGENTS.md:165` and `:208`; post-merge evidence does not satisfy that before-submission behaviour. Delete the competing validation policy and defer to AGENTS.md; no additional gate is needed.
4. AGREE — The two-attempt/footprint stop rules bound implementation without a clock-based process. Preserve assertions while allowing the explicitly required typed-prop and mock edits.
5. AGREE — Name the existing documentation test and retain the already-present valid script links; no new test or documentation sentence is needed to satisfy that assertion.
6. AGREE — No invented release; one patch at the end if a patch is requested. A specifically requested minor/major release retains AGENTS.md's existing rules.
7. AGREE — Delete the three named historical process documents when the plan lands; git history preserves them. This review does not perform those deletions.

## Blocking defects in the rewritten plan.md

- `tasks/plan.md:26`–`31` and `:180` defer complete validation until before the last merge, contradicting `AGENTS.md:165`–`166` and `:208`. Remove the competing timing rule and inherit repository policy.
- `tasks/plan.md:33` permits N2 to land alongside the code tasks, but N2 generates and commits `docs/**` (`:88`–`91`). `AGENTS.md:43`–`44` explicitly sequences generated assets after all batch code changes. Put N2 last; its source-file disjointness does not override that rule.

No additional blocking defects found. Existing test paths resolve within their stated directories; proposed new paths are identified as new; no necessary source edit outside N1/N2/N3/N5's footprints or impossible behaviour boundary was found. Suites were not run.

## Non-blocking improvements

1. Delete the repeated verified-baseline section (`tasks/plan.md:40`–`59`); the briefs carry the actionable facts. This also meets the shorter-plan target without compressing prose.
2. Delete the active-time/wall-clock accounting checkbox (`tasks/plan.md:181`); PR and validation outcomes already make completion reviewable.
3. Change N2's approximate range to include the naming promise at `docs-src/reference/development.md:154`; the current “395–450” pointer sends the implementer past it.
4. Replace “suites pass unchanged” and “never edit a test” with “preserve existing behavioural assertions”; N1 explicitly edits typed props and N3 changes mocks (`tasks/plan.md:25`, `:67`, `:77`, `:123`, `:147`).
5. Remove repeated lint from N2's focused list if retaining the shared per-PR lint instruction (`tasks/plan.md:26`, `:95`).

## Consensus

CONSENSUS: NOT AGREED because: the rewrite contradicts AGENTS.md on validation before submission and on landing generated documentation after the code batch.

---

# Round 2 — Reviewer A response to revision 3

## Blocking defects

None

## Residual notes for the owner

The integration-validation option requires the owner's acceptance of the proposed AGENTS.md bullet; otherwise the existing per-PR validation rule applies (`tasks/plan.md:38`–`43`).
If the owner chooses the per-PR fallback, the integration-run checkbox is inapplicable (`tasks/plan.md:204`).

## Consensus

CONSENSUS: AGREED
