# Make tactical changes easier: a bounded maintainability plan

Status: draft for review, not an instruction to begin implementation.
Date: 2026-09-05.
Baseline: `c0a6eb54ff1c91daf3c87198c8bcf1f31aebe064`, version `0.60.0-alpha.1`.
Scope of this document: reconcile the earlier findings, specify the recommended next batch, and describe separately selectable later work.

This file contains the plan, checklist and review questions. There is no separate to-do ledger and no build or test may depend on this document. Historical plans are evidence, not executable instructions. Approval of one batch does not authorize every later option described here.

## 1. Outcome and product context

CapacityLens is a small, self-hosted, week-granularity agency capacity scheduler. Its engineering should make it straightforward to change scheduling behaviour, maintain account isolation and preserve saved data. Budgets, timesheets, hour-by-hour workflows and mobile scheduling remain outside the product boundary.

The desired outcome is a smaller reading burden for a specific change. A contributor should be able to locate the behaviour, understand its explicit inputs and find the relevant tests without reconstructing an entire subsystem. An extraction succeeds when it gives a cohesive behaviour a clear owner and reduces implicit dependencies. Reducing a line count alone is insufficient.

This programme preserves visible behaviour. It does not promise new features, faster rendering or stronger security merely because files have moved. Its immediate benefit is easier maintenance and safer future changes; correctness improvements discovered during implementation must be identified separately.

The documentation site is a reading aid built with existing VitePress tooling. Correct prose and a successful existing build are useful. New documentation test suites, parsers, lint systems, capture frameworks and breadcrumb tests are outside this plan.

### What went wrong with the previous programme

The original feature queue was blocked on a broad foundation checkpoint. Work expanded into function metrics, source classification, shell/Vue parsing, exception ledgers and tests of that machinery. These mechanisms consumed effort before the proposed feature boundaries were delivered.

The recovery batch removed that machinery and delivered toolbar date navigation, toolbar activity filtering and external-resource rendering boundaries. This plan preserves those gains. No task below requires finishing repository-wide naming, test splitting or structural measurement first.

## 2. Current state and evidence

The original `tasks/plan.md` and `tasks/todo.md` were removed by PR #616. Their last pre-recovery contents are available at revision `e03e13e8`. This new file supersedes their execution instructions; the finding identifiers below are retained only for traceability.

The baseline comparison and direct source inspection establish the following. These are maintainability findings, not a fresh comprehensive correctness or security audit.

| Original finding                                          | Current status                                                                                                                                                      | Disposition                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| F1: ineffective column assertions                         | Complete: missing, extra and duplicate columns fail the TypeScript constraint in `server/src/tables/columns.ts`; compiler fixtures remain.                          | Retain; no new column-check project.                                                    |
| F2: incomplete dependency scanner                         | Complete: shared parser, dynamic imports, gate integration and account ownership coverage landed in original T02–T04.                                               | Retain existing protection.                                                             |
| F3: long functions inside small files                     | Partial: toolbar date/activity controls and external-resource rendering extracted; most original hotspots unchanged.                                                | Select named boundaries, not an exhaustive size campaign.                               |
| F4: generic persistence updates                           | Outstanding: `attachmentState.ts` exposes `update(Partial<...>)`; several controllers mutate related state independently.                                           | Later option N7; preserve transition semantics.                                         |
| F5: broad implementation-derived contracts                | Outstanding across store internals, grid/virtualization and account flows.                                                                                          | N5 and N6 address specific boundaries; account-wide work deferred.                      |
| F6: raw account responses interpreted by UI               | Outstanding: `accountClient.ts` returns `Promise<Response>`; `SecuritySection.tsx` validates session/provider payloads.                                             | N3 and N4 address sessions only.                                                        |
| F7: oversized tests                                       | Outstanding: cited app/server, scheduler model, persistence and allocation-modal suites remain large.                                                               | Move existing cohesive tests only when doing related work.                              |
| F8: naming/import conventions without general enforcement | Guidance landed in original T06; broad T07 enforcement did not. Account architecture enforcement exists.                                                            | Use guidance and local review; retire universal naming enforcement from this programme. |
| F9: uneven validation coverage/environments               | Useful core landed: pure shared production environment, typed server-script promises, browser/worker environments. Exhaustive inventory and docs lint were removed. | Retain current scoped checks; no obligation to restore removed coverage machinery.      |
| F10: import stages lose entity types                      | Outstanding: `shared/src/domain/importFold.ts` still uses loose records and double assertions.                                                                      | Later option N8.                                                                        |
| M1: unused `dayWidth` props                               | Outstanding in DateHeader, ResourceLane and forwarding callers.                                                                                                     | N1.                                                                                     |
| M2: stale/historical comments                             | Mostly outstanding; incidental updates do not complete the queue.                                                                                                   | Correct misleading comments within the affected footprint.                              |
| M3: primitive ownership wording/sidebar exception         | Current baseline again says `shadcn-generated` and retains a permanent sidebar exception.                                                                           | N2 corrects wording; retain existing exception policy.                                  |
| M4: fixture display-name drift                            | Outstanding; Studio/Acme/Web and Alpha/Beta examples remain.                                                                                                        | Correct touched fixtures where useful; no global replacement or fixture framework.      |

Original task reconciliation: T01–T04 and T06 completed; core T08 protections completed and were subsequently trimmed; T05 measurement tooling was removed; T12 and T17 received partial feature delivery. T07 and the remaining feature/consistency queues were not completed. None of those outstanding queues is automatically required by this plan.

### Useful concrete baseline observations

- The existing file-size check passes for 592 tracked production TS/TSX files, with a 400-line ceiling, zero temporary exceptions and the permanent sidebar exception. It excludes declarations and tests; it is not a universal source inventory.
- Its approximate diagnostic reports SchedulerToolbar at 220 lines and ResourceList at 227, compared with original recorded spans of 311 and 275. These are inspection signals, not acceptance targets.
- SecuritySection remains approximately 346 lines, ResourceLane's original recorded span is 336, useAllocationGesture is 335, SchedulerGrid is 266, import folding is 270 and workspaceLifecycle is 352. The memo-wrapped components are not all captured by the lightweight diagnostic; do not mistake that diagnostic for a complete syntax-aware inventory.
- `server/src/app.test.ts` has 3,698 lines; `schedulerModel.test.ts` 3,163; `src/data/persist.test.ts` 2,943; `AllocationModal.test.tsx` 2,643. Their length does not justify adding tests or imposing new limits.
- `docs-src/reference/development.md`, around lines 399–450, still documents deleted function budgets, test-size ceilings and task-ledger references. Regenerating HTML preserved this stale source prose. N2 addresses that concrete mismatch.

Before implementation, refresh only the selected task's paths and callers against its new base. Do not rerun a whole-repository audit to refresh this table.

## 3. Scope and economic limits

### Hard exclusions

Do not add dependencies, source scanners, function budgets, exception ledgers, naming/import lint rules, repository-wide inventories, test-size limits, generic state machines, generic response-decoder frameworks or new CI workflows.

Do not add documentation code or tests. Use the existing docs build when prose changes. Existing documentation tests remain untouched; deciding whether to remove them is a separate request.

Do not alter database schemas, released migrations/fixtures, exported wire shapes, stable IDs, public StoreState behaviour, account/workspace vocabulary, permission rules, session security policy or scheduling mathematics to facilitate an extraction.

Do not turn incidental nits into prerequisite work. Report discoveries honestly, but distinguish a blocker caused by the selected change from unrelated maintenance opportunities.

### Cost controls

1. Select a finite batch before implementation. The recommended first batch is N1–N4 only. N5–N8 are options, not a continuation trigger.
2. Use one implementation stream by default. No automatic reviewer chains or repeated consensus rounds. Independent review of this draft is useful; it does not create a requirement for multiple implementation agents per task.
3. Read the owning code, consumed contracts and relevant tests. Broaden reading only when a concrete dependency requires it.
4. List necessary additions before creating them. A type and small helper may live together; do not create one file for every symbol.
5. Treat 3–5 implementation/test files as a sizing signal, not a machine-enforced limit. Forwarding-only edits and generated HTML may exceed it. Explain them rather than creating a new exception mechanism.
6. After roughly 45 minutes of active implementation without a working boundary, provide a scope update: current obstacle, files changed and smallest remaining step. After roughly 90 minutes without focused checks passing, stop expanding and present the specific blocker or reduced task. These are proposed review checkpoints, not automatic cancellation or permission to abandon a nearly complete safe fix.
7. Separate active work from installation/build/test/CI waits in the completion note. Do not claim a percentage of weekly token usage without actual usage data.
8. Do not rerun successful unchanged suites for reassurance. Repeat checks after relevant changes or to investigate a concrete failure. Never increase timeouts, weaken assertions or relax coverage just to obtain green results.
9. Once the selected batch is complete, stop. A residual backlog is acceptable.

## 4. Delivery order and expected return

| Task                                              | Selection              | Relative effort before validation | Benefit                                                                                         |
| ------------------------------------------------- | ---------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| N1: remove unused scheduler props                 | First batch            | Small                             | Removes misleading geometry dependencies and forwarding.                                        |
| N2: correct current engineering guidance          | First batch            | Small, plus docs build            | Contributors stop following removed commands and obsolete policy.                               |
| N3: give session listing a typed client result    | First batch            | Medium                            | UI no longer owns session HTTP payload validation.                                              |
| N4: isolate session-management behaviour          | First batch, after N3  | Medium                            | Listing/revocation changes have one cohesive owner; shared settings coordination stays visible. |
| N5: narrow allocation-slice inputs                | Select later           | Small–medium                      | Allocation logic no longer receives all store internals.                                        |
| N6: isolate lane drawing                          | Select later, after N1 | Medium                            | Pointer listeners, cancellation and draw state have one owner.                                  |
| N7: encapsulate one persistence transition family | Select later           | Larger                            | Related save/retry bookkeeping is harder to update inconsistently.                              |
| N8: retain types through one import stage         | Select later           | Larger                            | Import repair can be understood without repeatedly losing entity types.                         |

These are relative estimates, not elapsed-time promises. Required full validation and CI may cost more time than implementing a small task.

Dependencies: N1 and N2 are independent. N3 precedes N4. N5 is independent. N6 follows N1 to avoid overlapping scheduler edits. N7 and N8 have no foundation-tooling prerequisite. N2 can land first to stop misleading contributors, but is not a prerequisite for app refactoring.

## 5. First batch: implementation briefs

### N1 — Remove unread scheduler geometry props

**Gap and positive change.** DateHeader and ResourceLane declare `dayWidth` without consuming it. Grid/row layers and tests still forward it. Removing that path tells a contributor that geometry comes from the values actually read, especially `geom`.

**Read first.** `src/components/scheduler/DateHeader.tsx`, `ResourceLane.tsx`, `SchedulerGrid.tsx`, `SchedulerGridRows.tsx`, `SchedulerGridRow.tsx`, and their direct callers found by reference search.

**Implementation.** Remove the two unused declarations and only the forwarding that becomes unused. Update the corresponding typed test props. Preserve `dayWidth` wherever the viewport, layout or other consumers use it. In particular, search each occurrence; do not globally remove the name. Remove the adjacent comment that explicitly requests dropping the unused ResourceLane prop with its caller.

**Footprint.** The five named production files plus directly affected fixture/caller files. This may exceed five files because the prop passes through several layers. No geometry, virtualization or type-contract redesign belongs here.

**Existing coverage.** `DateHeader.test.tsx`, `ResourceLane.test.tsx`, `SchedulerGrid.test.tsx`, `SchedulerGrid.identity.test.tsx`, `drawModeRerender.test.tsx`. Run them together during implementation. Compilation catches remaining required props and dangling indexed accesses such as `LaneProps["dayWidth"]`.

**Acceptance.** Neither component declares or receives the unused prop; real geometry calculations remain identical; existing layout/drawing/identity assertions pass. No new tests are needed for deleting an unread prop.

**Stop condition.** If a purportedly unused value affects geometry or timing, retain that use and narrow the deletion. Do not replace it with a new geometry abstraction.

### N2 — Correct obsolete engineering-policy prose

**Gap and positive change.** The development guide advertises checks and task files that no longer exist. The sidebar/lint comments call source-owned primitives generated. Correcting this prevents wasted commands and inappropriate edits to local primitives.

**Footprint.** `docs-src/reference/development.md`, the `reason` text in `scripts/file-size-exceptions.json`, and ownership comments in `eslint.config.js`; regenerate `docs/` using the existing build. Read `DECISIONS.md`, `AGENTS.md` and `docs-src/STYLE.md` as references, not an invitation to rewrite them.

**Implementation.** Describe the actual tracked production TS/TSX file cap and permanent sidebar exception; state that function spans are approximate diagnostics. Remove instructions for deleted function-budget commands, removed inventory/test ceilings and deleted task-ledger ownership. Remove the promise of a future mandatory naming-enforcement programme. Describe retained adapter type exceptions by their current role rather than an executable T15 dependency. Preserve accurate import-cycle, account-ownership and environment guidance.

Correct source-owned primitive wording without changing lint behaviour or exception semantics. Do not expand the file-size checker. Verify command names against `package.json` and gate lists, using one-off searches rather than a new documentation validator.

**Verification.** Format the touched source files. Run `pnpm run docs:build`; inspect the generated diff and open the changed development page. Confirm the relevant paragraphs, links and layout are readable. A harmless build hash change is possible; investigate content changes outside the source edits. No screenshots need recapture because application UI is unchanged.

**Acceptance.** The guide matches actual checks and no longer tells a reader to use the deleted tools/ledger. Primitive descriptions match ownership. No docs code/tests, lint rules or policy behaviour change.

**Boundary.** The generated site is an output of this task. Do not repair unrelated favicon, typography, breadcrumb or tooling issues encountered while viewing it.

### N3 — Return a validated session-list result from the client

**Gap and positive change.** `accountClient.listSessions()` returns `Response`. SecuritySection parses JSON, validates each session and distinguishes unauthorized, unavailable and invalid-row results. The protocol boundary should own that decoding so session UI changes need no knowledge of response envelopes.

**Read first.** `src/account/accountClient.ts`, `src/account/accountClient.test.ts`, `src/components/settings/SecuritySection.tsx`, `SecuritySection.test.tsx`, and the existing `isAccountSessionId` validator. Read the session endpoint only to confirm the response contract; do not change it.

**Recommended design.** Add one cohesive `src/account/sessionClient.ts` module containing the session view type, a private decoder and the session-list request. Migrate the sole production consumer to its typed result; remove the now-unused public raw `listSessions` method after checking all callers. Keep `apiFetch` and its timeout/credentials/audit-warning behaviour. Other account-client methods remain unchanged.

A result must carry either validated sessions or a distinguishable failure. Preserve HTTP unauthorized information even when JSON is unreadable, and distinguish invalid successful rows from an unavailable/unusable envelope because the current UI uses different messages. A small local discriminated result is appropriate. Do not use a universal response schema or expose `Response` through the new typed operation. Transport failures may be represented explicitly or thrown to the existing catch; document the single chosen convention and preserve logging/visible feedback.

**Exact compatibility details.** Preserve session-ID validation, finite date parsing, nullable expiry and boolean `current`. Reject the whole list if any row is invalid; do not render the valid subset. An empty valid list is not an error. Preserve the current error-category ordering for non-OK responses, malformed envelopes and invalid rows. Stale-result generation checks remain in the UI behaviour owner; a client decoder cannot decide which request is current. No session token becomes display data.

**Footprint.** `accountClient.ts`, new `sessionClient.ts`, SecuritySection and the two existing test files. A focused `sessionClient.test.ts` is justified for moved decoder cases; avoid copying the same payload matrix into both component and client tests.

**Existing coverage and gaps.** SecuritySection tests already cover failed/invalid lists, stale post-password requests and visible session rendering. Account-client tests cover wrapped requests and audit warnings elsewhere. Locate and move only payload-validation assertions to the new owner, retaining integration proof of visible errors. Add a small missing case only if the existing assertions cannot distinguish a required result category. Do not write a separate compiler-fixture or contract-test framework.

**Verification.** Run the old account-client suite, new session-client suite and SecuritySection suite together. Check successful/empty lists, invalid rows, malformed body, 401 and transport failure against the preserved UI outcomes. Record which assertions moved and any genuinely new scenario.

**Acceptance.** Session listing has one typed browser-client boundary; SecuritySection contains no session envelope/row decoder; unauthorized/invalid/unavailable feedback and generation protection are preserved. The low-level account client retains its other operations unchanged.

**Stop condition.** If this requires migrating provider links, invitations, command reconciliation or server contracts, the proposed scope is wrong. Stop and reduce it to session listing.

### N4 — Give session management one behaviour owner

**Gap and positive change.** Listing, refresh generations, revocation, uncertain outcomes and rendering sit beside password/provider logic in SecuritySection. A session-only change requires reading unrelated forms. Isolating this behaviour provides the first substantial demonstration that a smaller contract reduces maintenance effort.

**Dependency.** N3 must be complete. Its typed session result is the input boundary.

**Recommended ownership.** A feature-local `useSecuritySessions.ts` hook owns the list, load generation, mount/unmount handling, refresh outcome and revoke/reconcile operations. `SecuritySessions.tsx` renders the rows from explicit session/busy/revoke inputs. SecuritySection remains the coordinator for password/provider interactions and shared feedback. Types used only by the hook/view can live beside their owner; no barrel or central types catalogue is needed.

**Why a hook and a view.** Password change must await a session refresh; moving all session state into a child component would otherwise encourage imperative refs or event buses. A hook called by the coordinator makes that dependency explicit. The view has no account-client or store dependency.

**Existing coupling that must remain visible.** Password success calls refresh after revoking other sessions. Password/provider/session actions share busy state. Error and success surfaces are shared but independent: a session success may coexist with a password error; existing clear/fail calls determine when an error disappears. Preserve that sequence, rather than silently introducing independently enabled forms or new error placement.

The hook may receive the small set of existing feedback callbacks it actually uses, with explicit signatures. Do not pass the entire `useFieldError` return or a generic settings context. Keep the current busy ownership in the parent. If the callback contract becomes a dependency bag that is harder to read than the original function, revise the boundary before adding adapters.

**Compatibility cases.** An older list must not replace the post-password-change list. An unmounted owner must not apply a late list. Revoking the current session re-enters through the auth wall. Unknown current-session outcomes and the existing unauthorized paths must still reload. Unknown other-session outcomes reconcile through an authoritative list and retain the existing messages. Keep `accountCommandOutcomeUnknown` and command/idempotency behaviour intact. Do not treat a failed request as proof that nothing committed.

**Footprint.** SecuritySection, the two new session files, and existing SecuritySection tests. Move a cohesive session test group only if that makes the tests easier to maintain; retaining the current integration suite is acceptable. One focused hook/view test file is optional only for an identified boundary gap, not a quota.

**Verification.** Run SecuritySection and session-client tests. Existing integration cases cover password refresh, stale loads, current-session revocation, unknown outcomes, invalid lists and transport failure. Preserve those assertions against the real composition. Use existing auth browser coverage during the final gates; inspect the actual settings session flow when verifying the rendered extraction. This slice does not change provider wiring and does not justify a new OIDC harness.

**Acceptance.** Session-only logic is absent from the password/provider coordinator; the new owner can be understood with its explicit inputs and client result; the rendered controls and cross-section behaviour are unchanged. Show a short before/after explanation for “change the session expiry display” and “change unknown-revocation feedback”. No numeric file-count target is imposed.

**First-batch exit.** Stop after N1–N4 are verified and delivered. Report the benefits, remaining coupling, test movements and actual validation costs. Do not start the later options automatically.

## 6. Later options: select individually after the first batch

### N5 — Narrow allocation-slice capabilities

**Gap.** `createAllocationSlice` receives `StoreInternals`, derived from the whole parent factory, while consuming six members: `guarded`, `addAllocationsImpl`, `updateOwned`, `assertAllocation`, `findOwned`, `mutate`.

**Benefit.** A contributor can see exactly which store operations allocation actions may use. Changes to unrelated catalogue/history internals do not expand the slice's apparent contract.

**Approach.** Define an explicit consumed interface beside allocationSlice, using existing domain types and preserving generic function signatures where genuinely needed. Pass an object containing only these six operations from useStore. Use function references directly; avoid forwarding wrappers. Do not settle for a `Pick<StoreInternals, ...>` while still passing the whole object. Do not rewrite unrelated slice contracts or replace the public StoreState.

**Footprint.** `src/store/slices/allocationSlice.ts`, `src/store/useStore.ts`, `src/store/slices/sliceComposition.test.ts`; at most one adjacent contract file if the interface is too distracting inline. Read `storeInternal.ts`, `storeGuards.ts` and existing store types to preserve signatures; edits there require a specific necessity.

**Verification.** Existing `useStore.allocations.test.ts`, `useStore.crud.test.ts`, `useStore.undoSync.test.ts`, `useStore.tenancy.test.ts` and sliceComposition tests. Preserve viewer gates, merged-row validation, dates, clamping, stable series membership, account scoping and one undo snapshot per operation. Compile the real composition. No new type-testing harness.

**Exit.** Six real capabilities are passed, all existing behaviours remain, and the interface does not copy a large generic store framework. If maintaining the explicit signatures requires broad store surgery, report that tradeoff instead of expanding the task.

### N6 — Isolate ResourceLane drawing

**Gap.** ResourceLane mixes day/layer rendering with pointer listeners, hover/draw state, geometry lookup and teardown.

**Benefit.** Drawing and cancellation changes have one owner. Rendering-only changes need not navigate document listener lifecycles.

**Approach.** Extract one `useLaneDrawing.ts` hook taking explicit consumed dates/day states, geometry and draw callback. It owns the lane ref, stable client-X lookup, gesture state and listener cleanup. Return only ref, draw/hover values and handlers consumed by the lane. Keep BarsLayer's draw-mode subscription local and keep rendering layers in ResourceLane. Preserve memoization and callback identity; do not move a whole store subscription into the lane hook.

**Footprint.** ResourceLane, one hook and existing ResourceLane/draw-mode tests. N1 should land first. AllocationBar/useAllocationGesture and shared gesture mathematics are out of scope.

**Preserve.** Primary button, active pointer identity, re-entrant pointer protection, bare click, movement threshold, reverse/outside-lane drag, blocked start dates, crossing later blocked dates, Escape, pointercancel, unmount cleanup, viewer behaviour, time-off inertness and stable bar props. Inspect existing tests for these scenarios before claiming coverage; some may be covered in adjacent gesture suites rather than ResourceLane tests.

**Verification.** ResourceLane, drawModeRerender, AllocationBar interaction and SchedulerGrid identity/draw-gate suites. Run browser gesture coverage on Chromium, Firefox and WebKit using existing projects/presets. Choose existing gesture specs after reading their test names; do not infer coverage from filenames alone. Add only missing cases directly exposed by the extraction.

**Exit.** Rendering and gesture ownership are separate; no global gesture service or shared hook framework; existing render-count/identity and interaction checks pass. A geometry or interaction redesign is a separate task.

### N7 — Encapsulate one persistence transition family

**Gap.** `attachmentState.ts`, writeQueue and refreshController use generic partial updates for related state. The state owner already has useful operations such as `acknowledge`, `cancelRetry`, `beginAuthoritativeReloadFor` and `installSlice`; extend existing ownership instead of inventing a new state model.

**Benefit.** One save/retry change can be understood through named operations and their invariants. Callers are less likely to clear bookkeeping belonging to a newer edit.

**First slice.** Inspect the write-failure/retry family only. Identify exactly which updates must occur together and give that transition a named state-owner operation used by writeQueue. Leave unrelated hydration, account switching and suspension axes unchanged. Do not remove generic update until all consumers of a separately selected family have migrated; partial completion is explicit.

**Footprint.** `src/data/persistence/attachmentState.ts`, `writeQueue.ts`, and relevant existing persistence tests. Read refreshController/accountSwitch/attachPersistence as required to understand the shared fields, but do not rewrite them as part of this first slice.

**Coverage and risks.** Existing `src/data/persist.test.ts`, `src/data/persist.overlap.test.ts`, `src/components/ImportExport.persistence.test.tsx` and `e2e/persistence.db.spec.ts` cover related behaviour. Map exact tests for new edits during save, older acknowledgements, uncertain commits, retry cancellation and detach. A missing invariant test here can justify a focused regression: these paths protect saved user data.

**Preserve.** No replay of uncertain commits; no cross-account writes; a disposed owner cannot resume work; authoritative reload gates remain raised until reconciliation; newer edits retain their unacknowledged status; nested suspension depths remain independent. Never collapse independent state axes into a single enum to simplify the picture.

**Exit.** One identified transition is genuinely owned and all its call sites use it. State behaviour is unchanged. The first implementation brief must enumerate exact fields/callers/tests before edits; this option is not sufficiently specified to authorize an entire persistence rewrite.

### N8 — Retain entity types through one import stage

**Gap.** importFold builds loose record collections and casts them back to entity arrays for repair. A change to relationship handling requires recovering guarantees that the type system no longer expresses.

**Benefit.** A contributor can follow one repaired entity shape from the validated boundary to its final merge without repeated double assertions.

**First slice.** Inspect the existing sanitized input and table-key relationships. Select one ordered stage, preferably allocation relationship repair, and pass typed rows/maps to it. Use current entity types; keep unavoidable assertions at a justified validated boundary. Do not claim the initial unknown-data parsing is typed before validation actually establishes that guarantee.

**Footprint.** `shared/src/domain/importFold.ts`, at most one cohesive stage module and relevant existing import tests. No shared entity type, wire version, schema or migration changes.

**Verification.** Existing `shared/src/domain/mutations.test.ts`, `shared/src/lib/sanitizeImport.test.ts`, `shared/src/lib/integrity.test.ts`, `src/store/importHardening.test.ts` and server import scenarios in `server/src/app.test.ts`. Preserve row values, counts, parent-first repair, singleton handling, erasure, input non-mutation and atomic caller behaviour. Reuse existing ID stubs; do not change production ID generation to ease tests.

**Exit.** One stage retains meaningful types and removes downstream casts without hiding validation or moving the same record bag into a helper. First enumerate the actual sanitized guarantee and stage order; if these are unclear, return an analysis of that gap before broadening implementation.

## 7. Gaps, gates and validation cost

A gate should answer a concrete question. This plan adds no executable gates. “Gap” means evidence or a design fact still needed; it is not automatically a demand for another test suite.

### Existing baseline protection

Keep TypeScript, lint, formatter, current production file cap, import-cycle scanner, account architecture checks, production dependency checks, app/server tests, existing coverage thresholds and browser CI. Keep the retained environment, command-runner and CSP checks. No task changes their implementation.

The repository currently requires Node >=24 and pnpm. Its Green gate specifies `pnpm run gate`, `pnpm run gate:server` and `pnpm run e2e` before submission. That is a material cost even for a small refactor. The previous tactical plan's named-spec-only exception applied to that batch; do not silently carry it into this one.

### Gate A: scope understood, before editing

Confirm the task's current owner/callers, proposed boundary and existing relevant assertions. Identify specific missing coverage, if any. Confirm no new public contract, dependency or unrelated subsystem is needed. This is a short implementation note, not a second plan or additional reviewer role.

If the proposed boundary cannot preserve the identified coupling, stop and explain the conflict. An attractive extraction name is not evidence that the extraction works.

### Gate B: local behaviour preserved, during implementation

Use focused existing tests while editing. For N3/N4, compare the exact session outcomes; for N6, preserve pointer and identity behaviour; for N7/N8, prove the relevant saved-data invariant. Reuse assertions and existing fixtures. No new tests for N1's deleted unread prop or N2's prose/comments.

Root focused tests use `pnpm run paraglide:compile`, then `pnpm exec vitest run <explicit paths>`. Server-focused tests use `pnpm --filter capacitylens-server exec vitest run <server-relative paths>`. Confirm current scripts before execution.

Type-check, lint and format the affected code before paying for the full suites. Do not introduce a special validation runner for this plan.

### Gate C: finished diff and existing release-quality checks

Review the complete branch diff for behaviour drift, implicit coupling, unnecessary files, changes to tests that conceal regressions and unintended public metadata. Every reported item gets a disposition; unrelated nits do not automatically expand scope.

Under current repository policy, run the three complete commands on the final implementation revision using Node >=24. Run them sequentially by default and run only one Playwright process across worktrees. Avoid running a focused browser subset immediately before a full suite that exercises the same cases unless investigating a concrete failure.

If a check fails, first distinguish a relevant regression from unsupported Node, missing dependencies, port collision or contention. Reproduce under the supported quiet environment. A repeatable unexplained failure remains a blocker; do not “fix” it with changed assertions/timeouts. Record failed attempts and what resolved them.

### Gate D: delivery verified on GitHub

Use a fresh feature worktree from fetched origin/main, signed commits, a reviewed ready PR and normal merge. Use `gh` for GitHub operations. Current workflows run on main rather than automatically on PRs; a local green branch is not GitHub CI evidence.

After merge, verify the PR, merge SHA and triggered workflow outcomes, then clean up the task branch/worktree. Do not mark a selected batch complete while a required main run is still pending or failed. A failed main check blocks dependent delivery until diagnosed; it does not authorize unrelated cleanup.

### Proposed validation exception for review

For **N2 alone**, consider permitting formatter, source/diff review, existing docs build and rendered-page inspection as pre-submission validation, with existing main CI still running after merge. Its code/config edits are comments and a reason string only. This avoids full app/server/browser execution for prose-only behaviour.

This exception is a proposal, not active authority. It requires an explicit decision because it differs from the repository's blanket pre-submission gate. If not accepted, follow the current complete validation requirement. Do not weaken runtime validation for N3/N4, gesture work, persistence or imports to compensate for earlier over-testing of docs.

No blanket “full gates once per batch” shortcut is proposed: independently merged runtime PRs should not first receive their required verification at the end of the batch. If validation dominates elapsed time, select fewer tasks per batch rather than hiding that cost.

### Release policy

This review draft needs no version bump or tag. A later request to execute the batch does not by itself require an invented release for a behaviour-preserving refactor. If a release is requested, take one at the end, follow repository version/CI rules and update both package versions and comparison links. Never create a release per small extraction.

## 8. What is deferred or deliberately retired

| Work                                                            | Decision and revisit trigger                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Universal naming/import enforcement                             | Retired from this programme. Revisit only for a recurring concrete defect that existing lint/review cannot reasonably prevent.         |
| Function complexity/length budgets and exception inventories    | Retired. Use the existing lightweight diagnostic and actual reading difficulty.                                                        |
| Blanket test splitting                                          | Deferred. Move a cohesive group when it supports a selected behaviour; keep integration coverage and avoid shared fixture frameworks.  |
| Full password/provider extraction                               | Deferred after the session pilot. Revisit if remaining SecuritySection work is still difficult; preserve shared feedback explicitly.   |
| Grid/virtualization contract narrowing                          | Useful later, but not required by N1/N6. Start with SchedulerGridRows' consumed virtualization fields if selected.                     |
| AllocationBar/useAllocationGesture decomposition                | Defer until a concrete editing change needs it; high identity/interaction coupling warrants its own brief.                             |
| LoginScreen/ArchivedSection/remaining ResourceList splits       | Defer until a specific behaviour is selected. Existing file length alone is not urgency.                                               |
| Workspace lifecycle/auth adapter/auth environment decomposition | Defer. Locking, authority, replay and vendor contracts increase validation cost; no present defect was established by this review.     |
| Generic entity-route/anonymisation staging                      | Defer. Preserve transactions, redaction, released schemas and ordering; use a dedicated brief if a real change needs these boundaries. |
| Repository-wide comment and fixture renaming                    | Defer. Correct touched misleading material; preserve safety rationale, stable IDs and intentional arbitrary-string tests.              |
| Sidebar cap redesign                                            | Defer. Correct ownership wording now, retain the existing exception.                                                                   |
| Additional docs tests/tooling                                   | Excluded. Prose/build/manual inspection is the intended maintenance model for this work.                                               |

## 9. Review questions and decisions

Reviewers should assess the entire selected scope, report uncertainty and include minor observations. They should distinguish must-fix defects in this plan from optional alternatives. Do not execute the tasks while reviewing.

1. Does N1–N4 deliver enough useful code ownership improvement to justify its validation cost, or should the first batch be smaller?
2. Does N3's single sessionClient owner preserve the exact current distinction between failed envelopes, invalid rows and unauthorized refreshes? Is any required response case missing?
3. Does N4's hook/view split preserve password-triggered refresh, shared busy/error behaviour and unknown revocation outcomes without adding unnecessary indirection?
4. Are proposed file footprints complete, especially N1's forwarded/indexed prop types and N3's client mocks?
5. Which existing tests prove each important behaviour? Identify an exact missing scenario before requesting new test code.
6. Should N2 receive the narrow pre-submission validation exception described above? This is a workflow decision, not a code task.
7. Is N5's explicit allocation contract proportionate to its generic helpers, or would copying those signatures cost more than the boundary saves?
8. Is N6 the best next substantive scheduler task after the pilot? Identify identity/cleanup risks before proposing a broader gesture rewrite.
9. Are N7/N8 correctly held as later options needing a focused field/stage mapping, rather than treated as ready authorization for broad refactors?
10. Does any acceptance criterion reward shorter files while leaving the same coupling hidden elsewhere?

Adopt review changes that improve correctness or reduce work. Do not require reviewers to agree on all preferences before a bounded task can proceed. The owner selects the batch and resolves the explicit workflow exception; routine implementation choices within the selected scope do not require repeated permission.

## 10. Execution checklist and completion record

The checkboxes below are manual status only. CI must never parse them.

- [ ] Draft reviewed; selected batch and N2 validation decision recorded.
- [ ] N1: unread props removed, real geometry preserved, validation recorded.
- [ ] N2: obsolete guidance corrected, existing docs regenerated, validation recorded.
- [ ] N3: typed session-list boundary delivered, response distinctions preserved.
- [ ] N4: session owner delivered, cross-section integration preserved.
- [ ] Selected batch's PRs merged and required main workflows passed.
- [ ] Completion note records benefits, residual limitations, moved/new tests and actual work/wait costs.
- [ ] Work stops; later options remain unselected unless separately requested.

For each selected task, record a compact completion paragraph: PR/merge revision; before/after change scenario; actual file scope; checks and result; new versus moved tests; remaining limitation. Keep detailed command logs outside this document. No exhaustive function inventory, all-findings closure condition or zero-debt declaration is required.

A successful first batch leaves less misleading wiring and guidance, gives session behaviour a usable boundary, preserves the application and stops at the agreed scope.
