# Make CapacityLens easier to understand and maintain

Status: implementation in progress. Baseline: `34a1702a9d8e08d900136ceca6d6d63eaccb6a57`
(2026-09-05, version 0.59.1-alpha.1). Tasks and completion evidence live in [todo.md](todo.md).
This document proposes the engineering policy; existing repository rules remain authoritative until
the corresponding policy tasks land. Completion evidence is recorded as each task is validated and merged.

## Outcome

A contributor should be able to change one behavior by reading its implementation, a small explicit
contract, and focused tests. A smaller file is useful only when it reduces that reading burden.
Preserve product behavior, security decisions, public contracts, database schemas and released fixtures.
Fix defective engineering checks separately from behavior-preserving refactors.

## Baseline and complete coverage

The current file-size check passes for 587 production source files at a 400-line ceiling, with zero
temporary exceptions. The sidebar is a permanent exception. Function lengths are diagnostic only;
tests and operational scripts are outside the size policy. The runtime-cycle check passes, but a
scratch dynamic-import cycle also passes. These observations are a structural review, not a complete
correctness or security audit. Re-measure before implementation because main will continue changing.

| Finding | Current problem and evidence                                                                                                                             | Delivery tasks     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| F1      | [Column guards](../server/src/tables/columns.ts) accept missing columns because a declaration of type `never` is legal; unions cannot prove uniqueness.  | T01                |
| F2      | [Cycle scanner](../scripts/check-import-cycles.mjs) misses dynamic imports; its tests are outside the gate; the architecture suite has a second scanner. | T02–T04            |
| F3      | Large functions remain inside small files; measured hotspots and proposed boundaries appear below.                                                       | T05, T10–T17, T20  |
| F4      | [Persistence attachment state](../src/data/persistence/attachmentState.ts) exposes arbitrary partial updates across several controllers.                 | T13                |
| F5      | Store, scheduler and account-flow contracts derive from broad parent implementations.                                                                    | T12, T14, T15      |
| F6      | [Account client](../src/account/accountClient.ts) returns raw HTTP responses, leaving protocol interpretation in components.                             | T10, T11           |
| F7      | Tests remain large: app 3,698 lines; scheduler model 3,163; persistence 2,943; allocation modal 2,643.                                                   | T09, T20           |
| F8      | Naming, import organization and most architectural conventions lack enforcement.                                                                         | T06–T08            |
| F9      | Rule coverage varies by directory; shared production receives Node types; some architecture rules enumerate existing files.                              | T04, T05, T07, T08 |
| F10     | [Import fold](../shared/src/domain/importFold.ts) repeatedly converts entities to loose records and back.                                                | T16                |
| M1      | Unread `dayWidth` props remain in DateHeader and ResourceLane and their callers.                                                                         | T12                |
| M2      | Historical review identifiers, stale extraction references and repeated explanations obscure current contracts.                                          | T18                |
| M3      | Sidebar exception and lint comments describe source-owned primitives as generated; the exception has no growth bound.                                    | T05, T19           |
| M4      | Fixture display names such as Studio/Acme/Web and Alpha/Beta drift from the documented naming policy.                                                    | T19                |

## Design rules for the work

1. Keep orchestration visible: named stages show ordering, transaction scope and failure propagation.
   A coordinator can call several stages, but must not hide a second large implementation in a closure.
2. Give each module only the capabilities it uses. Prefer a local explicit interface over
   `ReturnType<typeof parentFactory>`, a whole store, or a generic mutable context. Preserve existing
   semantic aliases; do not introduce branded IDs or change external contracts in this programme.
3. Keep state transitions with their state owner. Replace arbitrary partial updates with named
   operations that preserve invariants. Use a discriminated union only for mutually exclusive states;
   independent state axes must remain independent. No generic state-machine framework is needed.
4. Validate external data once into a meaningful type. Preserve errors, response distinctions,
   transaction boundaries, request cancellation and stale-result protection.
5. Extract cohesive behavior, not arbitrary line ranges. Avoid pass-through helpers, giant dependency
   bags, broad barrels and one-file-per-trivial-function fragmentation. Keep small private helpers local.
6. Move relevant tests with each ownership change. Keep a small integration suite proving the pieces
   work together. Shared fixture helpers construct data explicitly; they must not conceal global setup.
7. Preserve useful safety comments and exported-symbol contract documentation required by
   [DEFENSIVE-CODING.md](../DEFENSIVE-CODING.md). State the current invariant once near its owner.

## Proposed enforceable budgets

These are initial policy choices to calibrate in T05 against syntax-aware measurements. Record any
adjustment and its evidence before enabling the gate. Do not enable noisy rules and suppress the output.

| Concern               | Proposed rule                                                                                                         | Existing debt treatment                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Production files      | Retain 400 physical lines; cover scripts and public runtime code too.                                                 | Per-file non-growing baseline; generated output excluded explicitly.               |
| Functions             | At most 100 nonblank, non-comment lines, including JSX; count methods, arrows, callbacks and memo-wrapped components. | Exact file/symbol baseline; remove when compliant.                                 |
| Control flow          | Cyclomatic complexity at most 12; statement nesting at most 4.                                                        | Same symbol baseline, with a specific decomposition task.                          |
| Composition functions | May exceed length only when they contain declarative wiring and no substantial embedded behavior.                     | Named, reasoned exception with a non-growing ceiling.                              |
| Tests                 | At most 600 physical lines per file; individual test callbacks follow the function budget.                            | Split by behavior; preserve assertions and integration coverage.                   |
| Exceptions            | Exact file/symbol, measured limit, reason and task reference.                                                         | Reject stale entries, growth, directory-wide exemptions and unexplained increases. |
| Module contracts      | Explicit narrow inputs/outputs at feature boundaries; no unused capability passed to extracted modules.               | Review evidence plus targeted dependency/contract tests.                           |

Line counts and import counts are inspection signals, not a score to optimize in isolation. Do not
penalize a migration registry for importing migrations. Type-only dependencies still cost reading
effort: inspect them and enforce layer direction even though they do not belong in the runtime-cycle graph.

For each refactor, record before/after function span and complexity, the contract fields actually
consumed, and the minimum files a reader needs for one named change scenario. Aim for an implementation,
its contract and focused tests; record justified exceptions rather than an artificial universal file cap.
The refactor fails review if it only relocates the same implicit coupling.

## F3: intended boundaries

Measured spans include comments and JSX and are not the future executable-line metric. The table is
an initial queue. T05 must inventory all over-budget functions, including nested callbacks; T20 closes
the remaining inventory through the same small-task process.

| Current unit             | Span | Proposed ownership                                                                                       | Behavior to preserve                                                                                             |
| ------------------------ | ---: | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `workspaceLifecycle`     |  352 | Separate provisioning/replay and erasure/replay capabilities, composed by the existing entry point.      | Lock ordering, atomic writes, authority checks, replay and audit outcomes.                                       |
| `SecuritySection`        |  346 | Password form, session management, provider connection; client-side decoders own wire formats.           | Reauthentication, partial failures, redirects, cancellation and visible messages.                                |
| `ResourceLane`           |  336 | Lane drawing gesture owns listeners/cancellation; rendering consumes geometry and explicit layer props.  | Pointer identity, blocked days, Escape, cleanup, inert behavior and stable bar props.                            |
| `useAllocationGesture`   |  335 | Separate gesture preview from commit decisions and accessibility announcements.                          | Working-day math, reassignment, clamping, stale edits, undo and keyboard behavior.                               |
| `buildAuthAdapter`       |  324 | Vendor normalization plus session/credential/federation capabilities behind the existing Auth contract.  | Verified identity, session expiry/revocation, admission proofs and capture lifecycles.                           |
| `AllocationBar`          |  324 | Interaction adapter and presentational bar; retain existing geometry helpers.                            | Focus, keyboard editing, drag/resize, label visibility and memoization.                                          |
| `SchedulerToolbar`       |  311 | Search, date navigation and display controls with their own narrow inputs.                               | Stable callbacks, keyboard behavior, preference scope and labels.                                                |
| `LoginScreen`            |  289 | Independent sign-in forms/provider actions and a short mode composition.                                 | Password/SSO mode policy, errors and safe redirects.                                                             |
| `registerEntityRoutes`   |  284 | Named per-operation handlers using the existing write pipeline.                                          | Scoped authorization, optimistic concurrency, redaction and error mapping.                                       |
| `anonymise`              |  280 | Explicit recognition, identity remap, domain remap and scrubbing stages inside the existing transaction. | Original-proof classification before remaps, trigger restoration, historical schema support and final FK checks. |
| `ResourceList`           |  275 | Filtering/view-model, resource actions and list rendering.                                               | Scoped reads, lifecycle, selection and focus behavior.                                                           |
| `remapAndValidateImport` |  270 | Typed sanitized rows, ordered remapping/repair, final merge and accounting.                              | Parent-first repair, erasure, singleton handling, atomic caller behavior and counts.                             |
| `buildAuthFromEnv`       |  270 | Explicit option groups composed through existing provider/security builders.                             | Environment validation, plugin configuration and migration timing.                                               |
| `SchedulerGrid`          |  266 | Explicit view-model/virtualization contract and interaction/render composition.                          | Dragged-row pinning, scrolling, accessibility and visible-window utilization.                                    |
| `ArchivedSection`        |  266 | Inactive-data loading, lifecycle commands and grouped display.                                           | Retry, stale-response protection, purge deadlines and confirmation names.                                        |

## Delivery order

1. **Make checks trustworthy:** T01–T04. Calibrate failures before relying on a green result.
2. **Establish bounded rules:** T05–T08. Baseline existing debt; reject new debt immediately.
3. **Refactor one behavior at a time:** T09 is the test-splitting pattern used alongside T10–T17.
   Start with the typed security-settings client and its three independent UI behaviors as a pilot.
   Use its before/after evidence to refine the pattern before changing persistence and authentication.
4. **Finish consistency and close the inventory:** T18–T20. Remove completed baselines and record the
   final evidence. Runtime rules belong in the gate, standing rationale in DECISIONS.md, practical
   instructions in development docs; the task ledger remains the implementation history.

T01 can proceed independently of scanner work. After foundation changes land, unrelated feature
slices can proceed concurrently only when their files and contracts do not overlap. Serialize shared
lint/config changes, shared contracts, scheduler work and persistence work within their respective areas.
T09–T20 describe work queues where indicated, not permission to put an entire queue into one pull request.

## Validation and release

Each task has focused checks in [todo.md](todo.md). On Node >=24, run the repository's required
`pnpm run gate`, `pnpm run gate:server` and `pnpm run e2e` before submission. Run E2E alone because
its ports are fixed. Do not run competing full suites across worktrees. Add account conformance for
account/auth changes, pinned Dex OIDC for provider changes, and cross-browser suites for gestures.
Rehearsal changes retain released-fixture spawn tests and real redaction/rollback evidence.

Use the repository's branch/worktree, signed-commit, review, ready-PR and normal-merge workflow for
each bounded change. Verify main CI and fix failures before dependent work proceeds. Keep changes
behavior-preserving unless explicitly identified as a check defect. Do not alter released migrations,
database fixtures, security versions or wire versions to make a refactor pass.

After docs-source changes, build and commit generated docs. Follow the crypto inventory when moving
crypto imports. Update the story reference before fixture display-name changes that affect documented
scenarios; capture any affected screenshots only after the batch's code/name changes land. A planning
document needs no version bump. Apply the repository's single-release-per-batch policy to implementation.

## Risks and completion criteria

- **False green checks:** missing/extra/duplicate column fixtures and dependency fixtures must prove
  failures. Test rule coverage on representative paths and newly added files, not only today's inventory.
- **Behavior drift during extraction:** characterize the affected scenario first, preserve ordering and
  error contracts, and compare integration results. Do not rewrite tests merely to match new internals.
- **Over-fragmentation:** reject helpers that hide no invariant or add a navigation step without narrowing
  the contract. Keep a short local ownership note where a subsystem has multiple stages.
- **Threshold gaming:** retain physical file limits, count nested functions, and review actual dependencies.
  No formatting compression, deleted safety rationale or larger exception limits to obtain green checks.
- **Moving baseline:** refresh measurements at task start; never silently drop a finding because its
  original filename changed. Follow the behavior to its current owner and update its ledger entry.

The programme is complete when all 14 finding rows have evidence, all planned capability slices are
checked off, no unowned structural debt remains, and required gates pass. Any retained exception must
be bounded and explain why further decomposition would make the code harder to understand. Completion
requires both passing rules and demonstrably smaller reading contexts for the representative scenarios.
