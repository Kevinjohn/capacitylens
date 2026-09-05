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
portability issue, now fixed. Repair merged in [PR #588](https://github.com/Kevinjohn/capacitylens/pull/588),
merge `ae51d417`. Branch gate run `33938212737` passed; all four compiler fixtures took 4.6 seconds
combined under CI coverage (previously 18.8 seconds). Subsequent main gate and browser runs
`33938939361` and `33938939353` passed on `dafcbad2`.

### T02 — Parse dependency syntax once (F2)

- [x] Add a shared scanner using the installed TypeScript parser; distinguish runtime and type-only edges.
- [x] Cover imports, inline type imports, re-exports, literal dynamic imports, aliases and supported file extensions.
- [x] Ignore comments/string contents; report unresolved internal edges and nonliteral imports explicitly.

Dependencies: none. Scope: medium, scanner module, fixtures/tests, existing cycle entry point.
Verification: negative cycle and positive acyclic fixtures; extension/index resolution and external-package
classification. Nonliteral imports require a documented bounded exception rather than silent omission.

Evidence (feature/dependency-scanner): the cycle entry point uses the shared TypeScript syntax
parser. Ten Node regression tests pass, including dynamic cycles, type-only edges, aliases and
extension/index resolution. Against the original entry point, dynamic-cycle, inline-type-cycle,
unresolved-import and nonliteral-import fixtures fail. Current production scan: zero runtime cycles.
The two generated Paraglide imports have an exact owner/specifier exception; nonliteral source imports
have no exceptions and fail. Independent review found no findings. Gate wiring follows in T03.
Full validation: Node 24.19.0; `gate` (3,650 tests), `gate:server` (1,730 tests),
`e2e` (257 tests) and `docs:build` pass. Merged in
[PR #587](https://github.com/Kevinjohn/capacitylens/pull/587), merge `dafcbad2`.
Main gate `33938939361` and browser run `33938939353` passed.

T02 compiler-mode follow-up (feature/dependency-emit-semantics): a compiler-backed fixture exposed
that inline type bindings retain module initialization in verbatim mode. The scanner now reads each
package's effective configuration, including inherited settings. Explicit type-only clauses remain
erased; inline bindings are runtime edges when preserved by the compiler. Thirteen focused tests
cover both emission modes, per-package differences and invalid/missing configs. Production scan:
zero runtime cycles. Main gate `33938939361` and browser run `33938939353` passed on `dafcbad2`;
this additional case was found by compiler comparison rather than those existing tests.
Follow-up validation: Node 24.19.0 `gate` (3,650 tests), `gate:server` (1,730 tests),
`docs:build`, rendered-page inspection and focused complexity lint pass. Independent review found
no findings. The first browser run passed 252 tests and timed out in five company-picker flows;
all ten affected-suite tests then passed in isolation. A full unchanged rerun passed all 257 tests.
The initial failure cause remains unconfirmed; no product/test behavior was changed to obtain green.
Merged in [PR #590](https://github.com/Kevinjohn/capacitylens/pull/590), merge `182605ed`.
Main gate `33940373222` and browser run `33940373331` passed, including Firefox, WebKit and strict OIDC.

### T03 — Integrate dependency checks into every gate (F2)

- [x] Replace the architecture suite's duplicate parser with T02 while preserving its storage/vendor rules.
- [x] Wire scanner/cycle regression tests into the root and relevant server gate.
- [x] Prove a newly introduced forbidden edge fails the gate entry point, including a dynamic edge.

Dependencies: T02. Scope: medium, `scripts/check-import-cycles*`, root package scripts and
`server/src/accounts/conformance/architecture.test.ts`.
Verification: Node test runner for scanner tests; server architecture suite; both policy gate commands.

Evidence (feature/dependency-gate-integration): the architecture suite now consumes the shared
parser/resolver through a small typed declaration, retaining all existing SQL/vendor ownership checks.
Six added fixtures failed with the old parser: template-literal imports, inline type-only imports
and exports, comment text, unresolved paths and nonliteral expressions. All 27 architecture tests
and 13 dependency tests pass with the shared parser. Both local gates and the server CI static job
run the dependency regression command. Temporary dynamic-cycle probes made both `gate` and
`gate:server` fail at the cycle check. A temporary template-literal import of controlTables from an
unlisted server sibling made `test:account-conformance` fail its storage-ownership assertion.
All probes were removed. Focused server type-check and architecture lint pass.
Node 24.19.0 `gate` (3,650 tests), `gate:server` (1,737 tests), `docs:build`,
rendered-page inspection and workflow YAML parsing pass. Both gate logs include all 13 scanner
regressions. Independent review found no findings. All 257 browser tests pass.
Merged in [PR #591](https://github.com/Kevinjohn/capacitylens/pull/591), merge `e481883a`.
Main gate `33941445053` and browser run `33941445063` passed, including the complete browser matrix.

### T04 — Enforce ownership by directory (F2, F9)

- [x] Replace manually enumerated coordinator/boundary membership with directory ownership where possible.
- [x] Keep intentional composition roots and SQL/vendor owners as exact, explained exceptions.
- [x] Add fixtures proving a newly added sibling receives the same restrictions as existing files.

Dependencies: T03. Scope: medium, architecture policy, tests and scanner fixtures.
Verification: architecture suite with direct, transitive, runtime and type-only forbidden edges. Preserve
the existing global SQL ownership scan; this task strengthens coverage rather than replacing it wholesale.

Evidence (feature/account-directory-ownership): directory discovery replaces coordinator, product-route,
account-route and auth-builder member lists. Every coordinator is traversed, including unused siblings;
private forbidden modules are covered by directory prefixes. SQL owner lists remain exact and their
responsibilities are documented. Vendor restrictions use parsed specifiers, including dynamic imports.
Ownership traverses runtime and type-only edges. The scanner records original erased type names so
terminal contracts/exceptions cannot authorize other facade symbols: Db is a pinned public alias,
AccountMember is the storage mapper's exact row type, and three named concrete adapter type edges
are non-growing T15 debt. Regression checks reject changed consumers, symbols, kinds and duplicates.
Eight temporary probes passed the old policy and failed the new policy: coordinator runtime, type-only
and transitive imports; product/account route siblings; an auth-builder sibling; and server/shared
vendor template imports. All probes were removed. Two transitive type fixtures and the symbol-metadata
fixture failed before implementation. All 42 architecture and 14 scanner tests pass, as do focused
server type-check and lint. Node 24.19.0 `gate` (3,650 tests), `gate:server` (1,752 tests),
`docs:build`, rendered-page inspection and scanner complexity lint pass. Independent review found
no findings. All 257 browser tests pass. Merged in [PR #592](https://github.com/Kevinjohn/capacitylens/pull/592),
merge `bcbc64fb`. Main gate `33942991948` and browser run `33942991947` passed, including the
complete browser matrix and pinned OIDC.

### T05 — Enforce structural budgets across source categories (F3, F7, F9, M3)

- [ ] Measure every production function, test callback and source file; publish the complete baseline inventory.
- [ ] Implement the plan's calibrated length/complexity/depth budgets and non-growing exact exceptions.
- [ ] Cover server/root scripts and public runtime code; reject stale baselines and unclassified source paths.

Dependencies: T03. Scope: repeatable tooling slices of 3–5 files: measurement/tests, then policy/gate wiring.
Likely owners: `scripts/check-file-sizes*`, `scripts/file-size-exceptions.json`, ESLint config and package scripts.
Verification: exact-threshold and over-threshold fixtures, memo callbacks, nested arrows, methods, JSX,
comments, blank lines, deleted symbols and newly added files. Run an inventory before choosing exceptions.
Count nested bodies consistently; do not accidentally give a long closure a free composition exemption.

Progress (feature/source-inventory): explicit path classification inventories tracked and untracked
nonignored files, including scripts, public runtime code, declarations, Vue, shell, styles and HTML.
Source-owned UI primitives remain production source. Generated roots, prose, assets, data,
configuration and patches are distinguished; unknown formats and unsupported entries fail.
Configuration and patches may contain embedded code and are not claimed as function-metric coverage.
Deleted tracked files leave the inventory so future budget exceptions can become stale.
The CLI supports a readable category summary and `--json` for the full path inventory.
Both local gates run discovery and its regression tests. Syntax-aware function measurements,
complete measured baselines and structural enforcement remain queued. The current inventory contains
1,024 source files. Review corrected test-support classification and two presentation nits; no findings
remain. All nine discovery/CLI regressions pass. A temporary untracked Python file made both full gate
commands fail at classification; the probe was removed. Node 24.19.0 `gate` (3,650 tests),
`gate:server` (1,752 tests), `e2e` (257 tests), focused formatter checks and complexity-12 lint pass.
The classification corrections were verified with focused regressions after the app gate.
Merged in [PR #593](https://github.com/Kevinjohn/capacitylens/pull/593), merge `a4890726`.
Main gate `33944108027` and browser run `33944108010` passed, including all browsers and pinned OIDC.

Progress (feature/function-metrics): JavaScript/TypeScript measurement uses public ESLint code-path
and parser APIs. Nested functions have independent complexity/depth; their bodies still contribute
to enclosing function length. Length excludes blank and comment-only lines, including multiple comments
on one line. Default values, optional chains, logical assignments and switch cases count as branches.
Implicit class initializers have separate complexity scopes; static blocks and field arrows are measured.
Symbols retain lexical ownership and callback labels, independent of line numbers. Indistinguishable
repeated callbacks use occurrence suffixes; reordering them requires baseline review. Inline directives
cannot suppress collection, and unsupported formats or parse/configuration failures are errors.
Both local gates run the measurement regressions. Vue/shell/embedded-code measurement, published
complete inventory and exact budget exceptions remain queued. All 1,021 JS/TS files parse successfully:
16,172 executable units, with 361 length, 156 complexity and three depth violations. These are overlapping
measurements, not enabled budget failures. All 13 regression tests and complexity-12 lint pass.
Node 24.19.0 `gate` (3,650 tests), `gate:server` (1,752 tests) and `e2e` (257 tests) pass.
A subsequent syntax probe found BigInt keys could throw during symbol formatting; a failing/passing
regression and one-line fix resolved it. Focused tests, lint, formatter checks and the complete JS/TS
measurement were rerun after that fix. Independent review found no remaining findings.
Merge/CI evidence is pending.

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
`gate:server` (1,730 tests), `e2e` (257 tests) and `docs:build` pass. Merged in
[PR #589](https://github.com/Kevinjohn/capacitylens/pull/589), merge `602903a8`; its docs CI passed.
Subsequent main gate `33938939361` and browser run `33938939353` passed on `dafcbad2`.

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
- [ ] Remove the three named T04 adapter type-debt entries as those contracts become independent.
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
