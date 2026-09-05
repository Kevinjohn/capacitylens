# Maintainability implementation tasks

Implementation is in progress. See [the plan](plan.md) for the baseline, finding IDs, budgets and invariants.
This checklist is the task source of truth; add commit/PR and verification evidence as tasks land.
Unchecked tasks remain queued; validation and merge evidence accompanies completed work.

## How to execute a task

Read the matching plan section, current owning implementation, its contract and focused tests.
Use one feature branch/worktree per independently reviewable change. A queue below is several changes:
take one unchecked capability, normally touching 3–5 implementation/test files, and leave the rest queued.
Import-only caller updates and required generated docs may exceed that count; list them explicitly.
If two independent behaviors need changing, split the work before editing. Do not invent a framework.

Each task must preserve the plan's invariants and pass its focused checks plus the common repository
validation in the plan. Existing test paths below identify coverage to preserve; update commands when
tests move. Root Vitest commands use `pnpm exec vitest run <paths>` after `pnpm run paraglide:compile`;
server commands use `pnpm --filter capacitylens-server exec vitest run <paths>` with server-relative paths.
Record before/after measurements for refactors and failing-then-passing evidence for check fixes.

## Foundation

### T01 — Make column assertions fail on drift (F1)

- [x] Replace inert declarations with an assertion that rejects missing/extra names; separately enforce uniqueness.
- [x] Prove negative cases fail with the real TypeScript compiler, while the current schema passes.
- [x] Correct the guarantee's comment; verify no table specification or released schema changes.

Dependencies: none. Scope: small, `server/src/tables/columns.ts` and focused assertion fixtures/tests.
Verification: server type-check and negative compilation fixtures. Run the fixtures from a test discovered
by the server gate so this guarantee is continuously checked. Duplicate detection may be a focused
runtime test if a simple type-level solution would be harder to maintain. Do not use a generic
`Assert<T extends true>` with a `never` failure branch: `never` satisfies that constraint too.

Evidence (feature/column-guards): `columns.test.ts` compiles the actual column owner with the
installed TypeScript compiler and server options. Before the fix, all three negative cases failed:
missing, extra and duplicate names each produced zero diagnostics across ten tables. After the fix,
each produces ten constraint failures; the unmodified schema compiles. Four focused tests, server
type-check and table-directory lint pass. Runtime definitions and released schemas are unchanged.
Full validation: Node 24.19.0; `gate` (3,650 tests), `gate:server` (1,730 tests),
`e2e` (257 tests) and `docs:build` pass. Independent review found no findings.
Merged in [PR #586](https://github.com/Kevinjohn/capacitylens/pull/586), merge `40cf8db2`.
CI follow-up (feature/column-compiler-scope): server coverage run `33937315433` found a 5.23-second
compiler fixture exceeding the five-second timeout. The type import through tables.ts loaded 1,199
files, including runtime database/authentication implementations. Moving the unchanged two interfaces
to a pure tableSpecs.ts contract reduces the compiler graph to 176 files while preserving existing
exports. A new dependency-isolation assertion fails before the extraction; all seven column/table
checks pass afterward. The four compiler tests also pass with coverage enabled. Emitted runtime
JavaScript for tables.ts and columns.ts is unchanged. Node 24.19.0 `gate` (3,650 tests),
`gate:server` (1,730 tests), `e2e` (257 tests) and `docs:build` pass. Review found only a path-separator
portability issue, now fixed. Repair merge/CI evidence is pending.

### T02 — Parse dependency syntax once (F2)

- [ ] Add a shared scanner using the installed TypeScript parser; distinguish runtime and type-only edges.
- [ ] Cover imports, inline type imports, re-exports, literal dynamic imports, aliases and supported file extensions.
- [ ] Ignore comments/string contents; report unresolved internal edges and nonliteral imports explicitly.

Dependencies: none. Scope: medium, scanner module, fixtures/tests, existing cycle entry point.
Verification: negative cycle and positive acyclic fixtures; extension/index resolution and external-package
classification. Nonliteral imports require a documented bounded exception rather than silent omission.

### T03 — Integrate dependency checks into every gate (F2)

- [ ] Replace the architecture suite's duplicate parser with T02 while preserving its storage/vendor rules.
- [ ] Wire scanner/cycle regression tests into the root and relevant server gate.
- [ ] Prove a newly introduced forbidden edge fails the gate entry point, including a dynamic edge.

Dependencies: T02. Scope: medium, `scripts/check-import-cycles*`, root package scripts and
`server/src/accounts/conformance/architecture.test.ts`.
Verification: Node test runner for scanner tests; server architecture suite; both policy gate commands.

### T04 — Enforce ownership by directory (F2, F9)

- [ ] Replace manually enumerated coordinator/boundary membership with directory ownership where possible.
- [ ] Keep intentional composition roots and SQL/vendor owners as exact, explained exceptions.
- [ ] Add fixtures proving a newly added sibling receives the same restrictions as existing files.

Dependencies: T03. Scope: medium, architecture policy, tests and scanner fixtures.
Verification: architecture suite with direct, transitive, runtime and type-only forbidden edges. Preserve
the existing global SQL ownership scan; this task strengthens coverage rather than replacing it wholesale.

### T05 — Enforce structural budgets across source categories (F3, F7, F9, M3)

- [ ] Measure every production function, test callback and source file; publish the complete baseline inventory.
- [ ] Implement the plan's calibrated length/complexity/depth budgets and non-growing exact exceptions.
- [ ] Cover server/root scripts and public runtime code; reject stale baselines and unclassified source paths.

Dependencies: T03. Scope: repeatable tooling slices of 3–5 files: measurement/tests, then policy/gate wiring.
Likely owners: `scripts/check-file-sizes*`, `scripts/file-size-exceptions.json`, ESLint config and package scripts.
Verification: exact-threshold and over-threshold fixtures, memo callbacks, nested arrows, methods, JSX,
comments, blank lines, deleted symbols and newly added files. Run an inventory before choosing exceptions.
Count nested bodies consistently; do not accidentally give a long closure a free composition exemption.

### T06 — Document the naming and ownership vocabulary (F8)

- [x] Specify PascalCase component/type files, camelCase hooks/utilities, kebab-case executable scripts,
      matching principal exports, type-import style and one cross-feature import-path convention.
- [x] Define account/workspace/provider-account vocabulary and acronym/semantic-ID conventions; preserve
      existing public names and wire fields through explicit compatibility exceptions.
- [x] Add a compact module ownership map and contributor examples; keep root instructions short.

Dependencies: none. Scope: medium, AGENTS.md, DECISIONS.md and `docs-src/reference/development.md` plus generated docs.
Verification: examples match actual modules; list exceptions for primitives, migrations, config and test
suffixes. Explain whether a filename denotes one component or a cohesive set; avoid generic `utils` buckets.

Evidence (feature/maintainability-conventions): development-guide tables specify principal and
collection names, acronym/ID vocabulary, import paths and explicit module ownership. Root guidance
links to the detailed rules; DECISIONS.md records why small consumed contracts matter. Primitive,
tool, generated and public-contract exceptions remain explicit. Existing differences are migration
debt for T07, not a claim of current enforcement. Real module examples were checked against source.
Docs build and visual inspection of the standalone page pass. Review corrected an import example;
the corrected examples and rebuilt output were verified. Node 24.19.0 `gate` (3,650 tests),
`gate:server` (1,730 tests), `e2e` (257 tests) and `docs:build` pass. Merge/CI evidence is pending.

### T07 — Enforce naming and imports (F8, F9)

- [ ] Encode T06 conventions with existing lint facilities where possible; prove valid/invalid examples.
- [ ] Apply rules to production and tests with exact exceptions for upstream-owned names and external fields.
- [ ] Migrate existing violations in one feature directory per change; remove each completed baseline.

Dependencies: T05, T06. Scope: tooling slice, followed by independent feature-directory rename slices.
Likely owners: ESLint config, policy fixtures and each affected directory's files/importers.
Verification: lint rule fixtures, package exports, type-check and feature tests. Do not rename stable IDs,
environment variables, routes, released migration files or serialized fields for stylistic consistency.

### T08 — Make validation coverage explicit (F9)

- [ ] Test effective lint configuration for app/shared/server production, scripts, tests and browser workers.
- [ ] Enable typed promise rules for server scripts already in its TS project; classify remaining tooling explicitly.
- [ ] Separate shared production's pure environment from Node-based tests and enforce forbidden platform imports/globals.

Dependencies: T03, T06. Scope: one source category per change; ESLint/tsconfig, policy tests and shared config.
Verification: representative-path lint checks, deliberate floating-promise failures, production Node-global
and import failures, and passing filesystem-backed tests under their test config. Inspect legitimate
platform requirements before narrowing shared types; preserve current runtime behavior.

### Foundation checkpoint

- [ ] T01–T08 complete; negative fixtures prove the advertised guarantees.
- [ ] Inventory assigns every over-budget symbol/test file to a bounded task or reasoned exception.
- [ ] Root/server gates pass; new debt fails without requiring a full cleanup first.

## Feature refactors

The foundation checkpoint gates all feature refactors below. Their dependency lines identify additional
test/feature ordering and the specific foundation contracts each task consumes.

### T09 — Split tests along behavior boundaries (F7)

- [ ] For each suite below, move one cohesive describe group per change, preserving test names/assertions.
- [ ] Extract only necessary explicit fixture builders; keep scenario setup visible and integration coverage.
- [ ] Update coverage/test discovery and prove assertion/scenario counts did not silently drop.

Dependencies: T05. Scope: repeated medium slices, one old suite, one destination and at most one fixture helper.
Queue: `server/src/app.test.ts` (CRUD, batch, import, CORS, concurrency), `server/src/db.migrate.test.ts`
(version groups; immutable fixture files stay untouched), `shared/src/domain/mutations.test.ts`
(assertions, lifecycle, import), `src/data/persist.test.ts` (switch, retry, reconciliation, teardown),
`src/components/scheduler/schedulerModel.test.ts`, `AllocationModal.test.tsx`, and remaining T05 inventory.
Verification: run old and new suites together and compare collected cases; preserve coverage thresholds.
Complete the relevant split immediately before or alongside each T10–T17 ownership change.

### T10 — Return validated account-client results (F6)

- [ ] Start with session listing and provider status/link operations; decode each response once at the client boundary.
- [ ] Preserve meaningful status/error distinctions, reauthentication, audit warnings and unknown command outcomes.
- [ ] Migrate each remaining raw-response consumer by capability until UI no longer interprets account wire formats.

Dependencies: T06, relevant T09 split. Scope: one operation family per change, `src/account/accountClient.ts`,
a cohesive result/decoder module, its consumer and focused tests (normally 3–5 files).
Verification: `src/account/accountClient.test.ts` and affected component tests; malformed JSON, invalid rows,
401/403/409, cancellation, unknown outcomes and successful results. A low-level HTTP helper may remain
private; no exported raw-response escape hatch that bypasses the completed feature boundary.

### T11 — Separate security settings capabilities (F3, F6)

- [ ] Extract password change, session management and provider connection in three independently tested changes.
- [ ] Make SecuritySection a short composition with explicit cross-section feedback only where required.
- [ ] Demonstrate that changing provider-status display no longer requires reading password/session internals.

Dependencies: relevant T10 operations and T09 split. Scope: one capability per change; SecuritySection,
one component/hook and focused tests. Keep provider/client contracts local to their owning feature.
Verification: password validation, session revocation/load races, current-session behavior, link redirects,
reauthentication and visible errors; account conformance and pinned OIDC for provider changes.

### T12 — Narrow scheduler contracts and separate gestures (F3, F5, M1)

- [ ] Remove unread `dayWidth` props and forwarding in a dedicated first slice; preserve real geometry inputs.
- [ ] Give grid rows/virtualization explicit consumed contracts; extract ResourceLane drawing and AllocationBar
      interaction/presentation in separate slices, then split gesture preview/commit/announcements.
- [ ] Separate toolbar search/date/display controls and grid orchestration using existing geometry/math helpers.

Dependencies: T05, T06 and relevant T09 splits. Scope: one named behavior per change, typically the owning
component/hook, its explicit contract/helper, focused test and import-only callers.
Verification: ResourceLane, DateHeader, AllocationBar interaction, drawModeRerender, SchedulerGrid identity,
allocationDrag and schedulerModel suites; full browser matrix for gestures. Preserve memo identity,
pointer cleanup/cancel, stale edits, keyboard focus, dragged-row pinning, time-off inertness and capacity signals.

### T13 — Encapsulate persistence transitions (F4)

- [ ] Characterize pending/in-flight/retry/reconciliation, suspension, switch and detach transitions in focused tests.
- [ ] Replace arbitrary `owner.update` calls one transition family at a time with named state-owner operations.
- [ ] Separate write/retry and hydration/switch contracts where possible; remove generic mutation access once migrated.

Dependencies: T05, persistence T09 split. Scope: transition-family slices in `src/data/persistence/`,
normally attachment state, one controller, its contract and focused tests.
Verification: deferred promises/fake timers for edits during save/reload, failed/uncertain commits, nested
suspension, rapid account switches and teardown. Preserve acknowledgements, no cross-account writes,
unsaved-change reporting and the rule against replaying an uncertain commit. Demonstrate that retry-policy
changes can be understood without opening unrelated switch implementation.

### T14 — Narrow store slice capabilities (F5)

- [ ] Define a consumed capability contract for one slice, starting with allocations; pass only those capabilities.
- [ ] Keep domain operations in their owning slice/helper and shared mutation/history mechanics in the store core.
- [ ] Repeat for the remaining slices; retain the existing public StoreState and action behavior.

Dependencies: T06. Scope: one slice per change, its contract, store composition/internal owner and focused tests.
Verification: store CRUD/import/undo tests and type-level contract checks; viewer gates, stale-ID behavior,
merged-row validation, series membership and irreversible erasure history remain unchanged.
Do not merely create a `Pick` alias while continuing to hand every consumer the unrestricted internals object.

### T15 — Narrow account flows and auth adapters (F3, F5)

- [ ] Start with explicit read-flow dependencies; migrate each child away from parent factory-derived contracts.
- [ ] Separate workspace provisioning/replay from erasure/replay, preserving the existing public flow interface.
- [ ] Extract auth adapter capabilities and auth option groups separately; keep vendor normalization at one boundary.

Dependencies: T04, T06 and relevant T09 splits. Scope: one flow/adapter capability per change, its leaf
contract, composition wiring and focused tests. Owners: `server/src/accounts/flows/`, localAccountFlows,
`authConfig/authAdapter.ts` and `authConfig/authFromEnv.ts`.
Verification: account conformance, credential durability, lifecycle and auth tests; pinned OIDC for federation.
Pin lock ordering, transaction/audit/replay behavior, fresh authority checks and verified identity handling.
No security/wire version change is expected; explain preserved contracts in each PR.

### T16 — Keep import stages typed (F3, F10)

- [ ] Establish a typed sanitized-row boundary, retaining table-key/entity relationships.
- [ ] Extract ordered remap, relationship/erasure repair and final merge/accounting stages one at a time.
- [ ] Remove downstream record/entity double assertions; contain any unavoidable assertion at the validated boundary.

Dependencies: T05, import T09 split. Scope: one stage per change, importFold, typed stage module and tests.
Verification: import fold, sanitizer, integrity, store import and server import tests; compare row values,
counts, parent-first repairs, singleton rules, erasure and non-mutation of input on failure. Keep remap
generation deterministic in tests without changing production ID behavior.

### T17 — Finish remaining measured coordinators (F3)

- [ ] Refactor anonymisation stages while retaining their exact ordering and current CLI/worker entry points.
- [ ] Separate generic entity handlers through the existing write pipeline, one HTTP operation per change.
- [ ] Split LoginScreen, ResourceList and ArchivedSection by the capability boundaries in the plan, one at a time.

Dependencies: T05, T06; relevant T09 tests; T15 before overlapping auth work.
Scope: repeated medium slices: owning coordinator, one stage/contract, focused tests and necessary callers.
Verification: anonymisation/redaction/schema and released migration spawn suites (original admission-proof
classification, triggers restored in order, dangling references, unknown schema fail-closed); entity route
authorization/concurrency/redaction tests; affected UI tests and browser flows. Follow crypto inventory
and docs regeneration when a crypto import moves. Do not claim anonymisation's post-commit FK check rolls back.

### Feature checkpoint

- [ ] T10–T17 complete; corresponding T09 suites follow the new ownership boundaries.
- [ ] Before/after evidence shows fewer implicit dependencies for each representative change scenario.
- [ ] Full gates and required account/OIDC/cross-browser checks pass; public contracts and schemas are unchanged.

## Consistency and completion

### T18 — Replace historical comments with current contracts (M2)

- [ ] Remove opaque review/phase labels and stale location claims in one feature directory per change.
- [ ] Consolidate repeated explanations at the invariant owner; retain concise caller notes where necessary.
- [ ] Preserve safety rationale, exported TSDoc and operational migration/compatibility provenance.

Dependencies: each affected refactor first. Scope: small comment-only slices, starting with entityRoutes,
ResourceLane and tables/columns; expand through a repository search, classifying every remaining match.
Verification: review each comment against current code; compare comment-only diffs and formatting.
Do not blanket-delete comments by regex or move essential safety context into an unrelated long document.

### T19 — Correct primitive ownership and fixture naming (M3, M4)

- [ ] Correct sidebar/lint ownership descriptions and replace the unlimited sidebar exception with a bounded one.
- [ ] Supply canonical explicit fixture-name helpers; replace nonconforming display names one suite at a time.
- [ ] Guard fixture construction conventions with positive/negative examples; classify intentional arbitrary-string tests.

Dependencies: T05–T07; relevant T09 split for large fixtures. Scope: ownership metadata as one small change;
fixture replacements as separate small changes in app.test, persist.test and the remaining name inventory.
Verification: structural-policy tests, affected fixture/UI tests and stable-ID assertions. Preserve IDs,
emails/test-ids and released database bytes. Do not globally replace ordinary strings or alter tests whose
subject is arbitrary input. Update story references and affected screenshots only when their scenarios change.

### T20 — Close the complete structural inventory (F3, F7 and all findings)

- [ ] Re-measure all source categories; finish each remaining oversized function/test through a separate bounded slice.
- [ ] Remove resolved baselines, justify bounded retained exceptions, and link all F1–F10/M1–M4 rows to evidence.
- [ ] Reconcile standing rules, development docs and actual gate behavior; verify representative reading contexts.

Dependencies: T01–T19. Scope: one remaining owner per change, then a small final evidence/documentation change.
Verification: complete structural inventory and negative gate fixtures, all repository gates, relevant
cross-browser/account/OIDC checks, and successful main CI. New regressions become explicit tasks rather
than disappearing from the inventory. Record residual limitations; do not mark unfinished queues complete.

## Final checkpoint

- [ ] Every task/queue item has commit/PR and validation evidence; all 14 original findings are accounted for.
- [ ] A contributor can locate behavior, its explicit contract and focused tests from the ownership map.
- [ ] No new unbounded exceptions, giant shared fixture framework or widened public contract was introduced.
- [ ] Documentation reflects enforced policy and the final implementation batch follows repository release rules.
