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
Merged in [PR #594](https://github.com/Kevinjohn/capacitylens/pull/594), merge `ed482d13`.
Main gate `33945375414` and browser run `33945375419` passed, including the full browser matrix and OIDC.

Progress (feature/shell-function-metrics): shell declarations are measured with the published
Tree-sitter Bash WASM grammar. The unused native install script is explicitly disabled; no native
compiler or new production dependency is required. Length counting is shared with JS/TS. Conditionals,
loops, non-default case arms, logical operators, parameter defaults and arithmetic ternaries contribute
to complexity; nested functions have independent complexity/depth. Quoted strings and heredoc data
cannot invent functions, and parser recovery is rejected. Both repository scripts parse: their four
functions are within all proposed budgets. The grammar parses syntax only and never executes commands.
Both local gates run shell regressions. Vue and remaining embedded-source measurement, the complete
published inventory and budget enforcement remain queued. All 10 shell and 13 JS/TS metric tests pass,
as do complexity-12 lint and formatter checks. Independent review found no findings.
Node 24.19.0 `gate` (3,650 tests), `gate:server` (1,752 tests) and `e2e` (257 tests) pass.
The first server check lacked server dependencies after the root-only package addition; a frozen install
of all three workspace projects resolved it without code changes. The lockfile remained current, and
existing documentation-tooling peer warnings were also present in the primary checkout.
Merged in [PR #595](https://github.com/Kevinjohn/capacitylens/pull/595), merge `fffa5331`.
Main gate `33946739998` and browser run `33946739996` passed, including all browsers and pinned OIDC.

Progress (feature/vue-source-metrics): Vue SFC scripts and authored JavaScript regions in templates
and CSS bindings share the existing ESLint metric collector. Dynamic arguments, directives, event
statements, interpolations, loop iterables/alias defaults and slot defaults are included. Each embedded
region has independent metrics and lexical identities for nested real functions. Regions use the same
proposed budgets as functions, preventing long event handlers or expressions from becoming exemptions.
The metric model follows authored source: it does not invent Vue-generated render callbacks or count
template directives as generated JavaScript branches. Template markup retains the physical file budget.
Original parser coordinates and comments preserve physical line counts through HTML entities and Unicode.
AST clones keep parser-owned parent graphs intact. Unsupported blocks/languages, external sources,
duplicate/unclosed blocks, recovered expressions and malformed CSS fail visibly. PostCSS delimiter
validation closes a parser skip for unterminated CSS v-bind(). New dependencies are development-only;
the scope manager and PostCSS versions match those already locked in the workspace.
Both local gates run Vue regressions. Remaining embedded code includes JavaScript in TLS renewal and
Docker health checks, alongside configuration/HTML coverage, complete inventory and budget enforcement.
All 13 Vue and 13 JS/TS regression tests pass, including exact budget boundaries, independent nested
scopes, class initializers, JSX/TSX, comments/entities/Unicode, stable identities and parser recovery.
The authored documentation component has four functions and eight regions, all within proposed limits.
Node 24.19.0 `gate` (3,650 tests), `gate:server` (1,752 tests), `e2e` (257 tests), `docs:build`,
formatter checks and complexity-12 lint pass. A frozen install covered all workspace projects.
Independent review found no functional issues; an unrelated JSON escape was restored before completion.
Making PostCSS explicit changes VitePress's optional peer path and therefore its scoped-style hashes.
All 38 regenerated HTML pages and the 108,648-byte CSS file differ only by a consistent bijective
mapping of 50 scope hashes and the CSS filename; no prose or style values changed. Rendered development
page inspection confirms styling, breadcrumbs and images. Its automatic favicon request returns the
same missing-file 404 as the baseline; neither tree supplies that asset. Generated-artifact review
found no issues. Merged in PR #596 (`748c0cbb2361b88960aa90f56e7334e0aa9be122`).
Main gate `33948238552` and browser run `33948238542` passed, including Chromium, Firefox, WebKit
and pinned OIDC. Docs, Docker, CodeQL, security and Scorecard also passed.

Separate CI follow-up: Dependabot run `33946797121` fails while updating Sonner from 2.0.7 to 2.0.8,
with `ERR_PNPM_UNUSED_PATCH` for the version-pinned 2.0.7 patch. The repository gate and all browser
jobs passed. Review the dependency and reapply its required patch in a separate change; do not relax
unused-patch enforcement or disable updates. The same failure recurred in run `33948293971`.

Progress (feature/sonner-patch-update): reviewed Sonner 2.0.8 and retained the unchanged CSP patch
under an exact 2.0.8 key. The original lockfile-only update fails with `ERR_PNPM_UNUSED_PATCH`;
the repaired update and frozen workspace install pass. A Node-owned regression imports both ESM and
CommonJS entry points in fresh DOM processes and verifies that neither injects a style element;
it also checks the application stylesheet import. Both entry-point probes fail against an unpatched
scratch copy, proving that the patch is necessary. Both repository gates run the new check.
Node 24.19.0 application gate (3,650 tests), server gate (1,752 tests), and E2E (257 tests) pass.
Rendered import-error toast inspection confirms readable text, the existing error accent and close
control. Formatter checks pass. Independent review found no findings, including nits. Merged in
PR #598 (`d60954ecf6d19415d2f2f7d64ca38bd09d01f7ad`). Main gate `33949216774` passed, and
Dependabot run `33949275286` now succeeds, verifying the failed update path is repaired.
Browser run `33949216779` passed, including all three browsers and pinned OIDC; docs, Docker,
CodeQL, security and Scorecard passed.

Progress (feature/api-healthcheck-script): the API image invokes a standalone server script instead
of a compressed JavaScript command inside Dockerfile. HTTP redirect handling, 2xx status bounds,
certificate/key scheme selection, configured CA and api-hostname verification, loopback-only no-CA
TLS, and error exit statuses are preserved. Eighteen real HTTP/TLS characterization cases passed
against the original inline command and after extraction. A nineteenth test verifies Docker wiring;
these replace the old source-string assertions. All 25 focused healthcheck/environment tests pass.
The 27-line production script exposes all four callbacks to the existing function inventory; each
is one non-comment line, with complexity at most three and no statement nesting. A reader needs the
Docker invocation, script and focused behavior test to change the health probe; no new abstraction
or capability contract is introduced. The production pnpm deployment contains the identical script,
and that deployed copy passes a real HTTP probe. Independent review found no findings or nits.
The crypto inventory follows the TLS probe to its new owner. Docs build passes; its only generated
change is the byte-identical published JSON inventory, with no rendered page changes.
Node 24.19.0 application gate (3,650 tests) and server gate (1,770 tests) pass. The first E2E run
had three company-selection timeouts before palette assertions (254 passed); browser inputs are
unchanged from main. All 14 palette tests passed with tracing, followed by all 257 E2E tests in a
quiet worktree with reload logging. The initial cause remains unconfirmed; no timeout or assertion
was relaxed. Docker build and production smoke `33950100654` passed on the exact feature commit
`2b6fdd2fd9693817aae8e94fe81d2862e1250125`; Compose waited for the API container to report healthy
before starting nginx. Merged in PR #599 (`a690972a9373dec96ba6ab47e718f9735b0935ad`).
Main gate `33950406954`, Docker, docs, CodeQL, security, Scorecard and the dependency update passed.
Browser run `33950406927` passed, including Chromium, Firefox, WebKit and pinned OIDC.
Embedded TLS renewal/configuration coverage
and complete structural budget enforcement remain queued.

Inventory follow-up: importing `source-inventory.mjs` from `node --input-type=module -` fails in
its CLI-entry guard because it calls `realpathSync("-")`. The parameterless stdin invocation works.
Cover the importable API under an explicit stdin entry point when wiring the structural-policy CLI.

Progress (feature/source-file-budgets): physical-file enforcement now consumes the canonical source
inventory: 1,036 source files instead of 588 tracked app/server/shared TS files. Production and
declaration files have a 400-line ceiling; test and test-support files have a 600-line ceiling.
There are 39 exact measured exceptions: 37 test suites owned by T09, the 735-line source-owned sidebar
owned by T19, and the 630-line global stylesheet owned by T20. Every entry has a non-growing cap,
reason and verified task heading. No permanent/unbounded exception remains. Duplicate entries,
invalid metadata, unknown roles, missing files, and resolved or growing debt fail. Both gates run
the policy and its regression suite. Prose/data/assets/configuration/patch categories remain separate;
this slice does not claim embedded-code or function-budget completion.
Eleven regressions pass. The old checker accepted an untracked 401-line script and 601-line test;
the new checker rejects both. Temporary probes were removed. Changed functions meet 100/12/4 limits.
Review identified a task-reference gap: a syntactically valid but nonexistent T99 owner passed.
A failing regression now passes with task IDs checked against headings in tasks/todo.md. The old
approximate function diagnostics are removed; canonical collectors and function enforcement remain
in this task's queue. Development documentation records the exact scope and exception rules.
The task-reference fix and documentation passed independent review with no remaining findings or
nits. Docs build passes; the rendered development guide has correct policy paragraphs, breadcrumbs
and images. Node 24.19.0 application gate (3,650 tests), server gate (1,770 tests), E2E (257 tests),
and formatter checks pass. Both complete gate commands reject the same 401-line script and 601-line
test probes at file-size enforcement before their application/server test suites. Probes are removed;
the clean policy check passes with exactly 39 exceptions. Merged in
[PR #600](https://github.com/Kevinjohn/capacitylens/pull/600), merge `1ad9c51c`.
Main gate `33951641510` and browser run `33951641436` passed, including all three browsers
and pinned OIDC. Docs, Docker, security, CodeQL and Scorecard passed.

Progress (feature/function-budgets): the canonical JS/TS, Vue and shell collectors now feed a
shared evaluator in both gate commands. Limits are 100 nonblank/non-comment lines, complexity 12
and nesting depth 4. The initial baseline has 520 over-limit metrics across 475 units, each recorded
by exact file/symbol/metric, current measured limit, reason and real cleanup-task heading. A length
exception never relaxes complexity or nesting. Growth, deleted symbols, individually resolved
metrics, duplicate measurements/entries and malformed policy fail. No new policy function exceeds
the limits. The CLI's JSON report publishes current measurements, source ownership and paths whose
embedded code remains outside this function gate. CSS/HTML retain physical budgets; configuration,
patch fragments, top-level module/shell control flow and other embedded code remain queued in T05.
Nine focused regressions pass, including nested callbacks in new files, syntax/discovery failures,
all metric boundaries, exact exceptions, coverage reporting and CLI status. The explicit-stdin
import regression failed before correcting the inventory/file-budget guards and passes afterward.
Both full gate commands rejected a temporary 101-line function and a complexity-13 test callback
at the function-budget step before their application/server test suites; both probes were removed.
Independent review found no findings or nits. Follow-up inspection found that the coverage report
omitted data containers such as package.json; it now lists every excluded inventory category, with
regressions for command strings and generated code. The nine focused tests pass after that change,
and follow-up review found no issues. The final inventory has 16,360 units in 1,036 measured files
(1,039 physical source files); all 520 exception values equal their current measured baselines.
Node 24.19.0 application gate (3,650 tests), server gate (1,770 tests), focused lint/formatter checks
and docs build pass. The rendered guide has the correct policy paragraphs, coverage limitations,
sidebar, breadcrumbs and intact images. All 257 browser tests pass in an unchanged worktree.
Merged in [PR #601](https://github.com/Kevinjohn/capacitylens/pull/601), merge `82516aa9`.
Main gate `33952632902` and browser run `33952632933` passed, including all three browsers
and pinned OIDC. Docker, docs, security, CodeQL, Scorecard and Dependabot also passed.

Progress (feature/tls-renewal-verifier): the coordinated renewal shell command calls a dedicated
server script for live-generation verification. The 45-line shell workflow is now 18 lines, retaining
the same build/stop/rotate/restart order and the comments explaining the maintenance window and
nginx verification path. The 27-line verifier preserves the Compose URL, trimmed marker, strict
fingerprint equality, 2xx status bounds, response parsing and error/exit behavior. Its four callbacks
are now measured: maximum 19 code lines, complexity six and nesting depth two. No new exception is
needed. Moving the old orchestration assertion alongside the behavior tests lowers the existing
internalTls test-suite length baseline from 224 to 212.
Eighteen characterization cases passed against the original inline command and the extracted script.
With the moved order/wiring assertion and existing TLS tests, all 36 focused cases pass. The fixture
asserts the exact Compose destination before redirecting only that request to a real ephemeral HTTP
server; production code receives no test URL option. A predicate change now has a direct script owner
and focused behavior tests, without shell-string quoting. The deployed production package contains
the byte-identical script, and that copy passes a real HTTP probe. Cryptographic discovery remains
unchanged at 42 implementation paths; the verifier compares an existing digest and adds no primitive
or TLS configuration. The Docker smoke workflow now executes it through the actual Compose network.
Independent review found no findings or nits. Node 24.19.0 application gate (3,650 tests), server
gate (1,788 tests), focused lint and formatter checks pass. All 257 browser tests pass in an
unchanged worktree. Docker workflow `33953532711` passed on feature commit
`d8dcfd2a413c201bde7b293ac0c31eb7e415e506`; its new live-generation step executed the deployed
script through nginx and reported coordinated renewal verified. Merged in
[PR #602](https://github.com/Kevinjohn/capacitylens/pull/602), merge `b6d0c1b3`.
Main gate `33953889132` and browser run `33953889072` passed. Docker, security, CodeQL
and Scorecard also passed.

Progress (feature/ordered-validation-gates): package scripts select a small gate runner backed by
explicit ordered pnpm argument arrays. Shared structural checks are listed once; application and
server-specific checks remain visible in their own lists. The runner reuses the repository's pnpm
launcher and runs from the repository root with inherited environment and terminal streams. Ordinary
command exit codes propagate and stop later checks; failed starts and signals use the launcher's
existing diagnostic/status policy. Unsupported modes and extra arguments fail before execution.
A mechanical comparison against the original shell chains confirms all 28 application and 18 server
commands and argument order are retained. Bare tools now use pnpm exec. The only added command is
the runner's regression suite in both gates. Six subprocess tests pass, proving sequence, working
directory/environment, early stopping, status propagation, signal/start failures and argument rejection.
All new source is within the structural budgets. Both complete gate commands rejected a temporary
101-line function at the function-budget check before runtime tests; the probe was removed.
Independent review found no findings or nits. Node 24.19.0 application gate (3,650 tests),
server gate (1,788 tests), focused lint and formatter checks pass. All 257 browser tests pass
in an unchanged worktree. Merged in [PR #603](https://github.com/Kevinjohn/capacitylens/pull/603),
merge `6b1ba9d0`. Main gate `33954921245` and browser run `33954921279` passed, including
all three browsers and pinned OIDC. Docker, docs, security, CodeQL, Scorecard and Dependabot passed.

Progress (feature/module-control-budgets): JS/TS module scopes, Vue script control flow and shell
top-level flow now receive complexity/depth limits of 12/4. Module length retains the physical file
budget; nested function control metrics and lexical identities remain independent. Vue script blocks
share one script scope, separate from template/style regions. Seven newly exposed module complexity
exceptions have exact measured caps and specific T20 decomposition reasons; no existing cap grows.
Four new regression tests failed before implementation and pass afterward; all 49 focused metric and
policy tests pass. Both complete gates reject temporary JS and shell modules with complexity 13
before runtime tests; the probes were removed. Comparing the original and updated collectors over
all current source proves that all 16,424 non-program scope records retain identical symbols,
coordinates and metrics across 1,044 files. Independent review found no functional issues; its
Unicode formatting nit was corrected, leaving the original 520 exception entries byte-identical.
Docs build and rendered-policy inspection pass. Node 24.19.0 application gate (3,650 tests),
server gate (1,788 tests), focused lint and formatter checks pass. All 257 browser tests pass
in an unchanged worktree. Final review found no findings or nits. Merged in
[PR #604](https://github.com/Kevinjohn/capacitylens/pull/604), merge `2f86f5dc`.
Main gate `33955641118` and browser run `33955641114` passed, including all three browsers
and pinned OIDC. Docker, docs, security, CodeQL and Scorecard also passed.

Progress (feature/docs-lightbox-source): the docs Escape handler is authored in a six-line source
file, scripts/docs-lightbox.js, read by VitePress at build time. The published script remains inline,
so standalone file:// pages gain no external script dependency. The source is covered by formatting,
recommended JavaScript lint with browser globals, and the structural gate; no new exception is needed.
The authored handler matches the original config string exactly apart from its final file newline.
Docs build leaves all 38 committed HTML pages and other generated artifacts byte-identical.
Eight keyboard characterization cases passed on the original string. The updated suite passes all
23 tests: eight cases each against authored and published code, plus seven built-site checks.
VitePress minifies the published script, so tests pin a consistent published handler across pages
and exercise both authored and published behavior.
Type-check and focused lint pass. Actual browser verification confirms open → Enter retains open →
Escape closes, then successful reopen and Escape again. The generated page has correct breadcrumbs,
intact screenshots, and exactly one inline script with no src. Open and closed renders were inspected.
Independent review found no findings or nits. Node 24.19.0 application gate (3,666 tests),
server gate (1,788 tests), focused type/lint/formatter checks and docs build pass.
All 257 browser tests pass in an unchanged worktree.

The docs lightbox extraction merged in [PR #605](https://github.com/Kevinjohn/capacitylens/pull/605),
merge `05711592`. Main gate `33956431695`, E2E `33956431737`, docs, Docker, security, CodeQL
and Scorecard all passed.

Progress (feature/dependabot-config-validator): the workflow's inline Ruby field validator moves
to scripts/check-dependabot.mjs, owned by the application gate and its existing CI job. The exact
development dependency yaml 2.9.0 supplies YAML 1.1 parsing; no existing dependency version changes.
Forty-nine cases match the prior field policy and relevant safe-loader acceptance, using the old
validation body with the local Ruby file reader adapted to safe_load. Duplicate keys, extra documents
and unknown tags are intentionally rejected more strictly. Twelve focused validator/runner tests pass.
An invalid configuration stops the real application gate before Vitest; the original file is restored.
Frozen installation and docs build pass. Generated output changes only by 51 consistently mapped
scope identifiers and the stylesheet filename across 38 pages; the development page was inspected
in a real browser. Node 24.19.0 application gate passes with 3,666 tests; the complete server gate
passes with 1,788 tests and E2E passes all 257 tests. Review found no additional issues. Merge evidence
remains pending. Embedded executable-code coverage
elsewhere remains queued; this extraction does not complete T05.

Merged in [PR #606](https://github.com/Kevinjohn/capacitylens/pull/606), merge `38897fa4`.
Main gate `33957789859`, docs, Docker, security, CodeQL and Scorecard pass. Main E2E `33957789670`
and the dependency-update run remain in progress at this checkpoint.

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
- [x] Separate shared production's pure environment from Node-based tests and enforce forbidden platform imports/globals.

Dependencies: T03, T06. Scope: one source category per change; ESLint/tsconfig, policy tests and shared config.
Verification: representative-path lint checks, deliberate floating-promise failures, production Node-global
and import failures, and passing filesystem-backed tests under their test config. Inspect legitimate
platform requirements before narrowing shared types; preserve current runtime behavior.

Progress (feature/server-script-promise-rules): server/scripts/**/*.ts now receives the existing
typed floating-promise and misused-promise rules, matching server/tsconfig.json's include. Four
effective-configuration regressions inspect every current TypeScript script, a future nested path,
and tooling outside that project. Real lintText checks prove both promise violations fail and handled
promises pass using an existing script's project. Before the change, both violations were accepted
and the configuration/gate ownership tests failed. All four tests and existing server script lint
now pass without script edits or suppressions. Both gates run the regressions. Independent review
found no findings or nits. Node 24.19.0 application gate (3,666 tests) and server gate (1,788 tests)
pass, and E2E passes all 257 tests. Merge evidence remains pending; the wider environment coverage
and shared production/test split remain queued.

Progress (feature/shared-production-environment): shared production and tests have separate
TypeScript environments. Standard web declarations retain the existing Headers contract and
portable UUID/UTF-8/console capabilities; production lint rejects other platform globals and Node
imports. A compiler-graph regression rejects Node types and test files pulled into production,
including declarations loaded by dynamic imports. Tests retain Node filesystem access and typed
promise checks. The corrected six-test suite fails four checks against the previous configuration.
Review identified incomplete test-suffix coverage; the TypeScript/ESLint patterns now cover test/spec
files across TS, TSX, MTS and CTS, plus test-support directories. A seventh regression checks real
temporary files, and the compiler graph uses canonical source roles. All seven tests pass and
follow-up review found no remaining issues. A real production Node import stops both full gates;
the probe is removed. Documentation build and rendered-page inspection pass. No runtime implementation
or shared contract changes. Initial full application/server gates pass. A final negative probe showed
that aliasing globalThis bypasses named global-property checks, so production now forbids the entire
global object; direct portable capabilities remain available. The regression fails before this fix.
Final Node 24.19.0 application gate (3,666 tests) and server gate (1,788 tests) pass. Final rendered
documentation and follow-up review pass. E2E passes all 257 tests. Merge evidence remains pending.

The server-script promise-rule slice merged in [PR #607](https://github.com/Kevinjohn/capacitylens/pull/607),
merge `f1482dac`. Main gate `33958243481`, E2E `33958243468`, docs, Docker, security, CodeQL and
Scorecard all pass. PR #606's browser run was superseded by this newer main run: Chromium, Firefox
and pinned OIDC passed on #606; WebKit was cancelled by workflow concurrency. The complete succeeding
run passes with the Dependabot validator unchanged. PR #606's dependency-update run also passed.

T08 progress (feature/browser-script-lint-environments): browser and service-worker JavaScript no
longer inherit Node globals from the common JavaScript baseline. Browser defaults apply to public
scripts and the authored docs lightbox handler; the offline worker retains service-worker globals.
Node tooling retains Node globals. Four regression groups exercise actual lint results for existing
and future browser paths, the worker, and root/server tools, and are wired into both gates. Before
the fix, process, Buffer, require and __dirname were all accepted in browser code. Focused checks
pass after the change. Review found no findings or nits. Node 24.19.0 application gate passes with
3,666 tests. With the shared lint CI repair incorporated, both CI-mode gates pass: application
3,666 tests and server 1,788 tests. E2E passes all 257 tests; broader T08 coverage remains open.

T08 CI repair (feature/shared-lint-ci-fixture): main gate `33959389758` on PR #608 failed the
shared test-project promise probe. The failure reproduces locally with CI=true: the typed parser's
single-run mode reads the project from disk, so lintText over an existing path did not diagnose the
supplied floating promise. The regression now lints real temporary test files, one with a floating
promise and one with an awaited promise; both retain a filesystem import. Fixtures are removed after
the test. All seven checks pass in normal and CI modes. Node 24.19.0 CI-mode application gate
(3,666 tests) and server gate (1,788 tests) pass. Review found no findings or nits. E2E passes all
257 tests. Branch CI verification remains pending.

Repair merged in [PR #609](https://github.com/Kevinjohn/capacitylens/pull/609), merge `f620c114`.
Branch gate `33960023633` passed on `45bae4fa`. PR #608's main E2E `33959389740` also passed;
the CI-only fixture failure did not affect the runtime or browser suites.

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
