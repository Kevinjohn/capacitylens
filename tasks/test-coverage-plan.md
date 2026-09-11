# Test coverage improvement plan

Status: completed 2026-09-09. Base reviewed:
`135cc016a39f9ed6c7dc8ff363d6d1a37014c854`.

This plan closes confirmed behavioural test gaps, distinguishes existing tests that are excluded
from the headline coverage report, and refreshes the evidence before changing any coverage policy.
It does not promise an undifferentiated “90% coverage”: statements, branches, functions and lines
have different denominators and must be reported separately.

`tasks/plan.md` governs the separate conventions programme. Its programme-specific validation and
CI exceptions do not apply here.

## Outcome

- Every behaviour named below has either a new regression test or a citation to an existing test.
- Fresh app and server coverage is recorded at one pinned revision under Node 24 or newer.
- Security, tenant-isolation, failure-recovery and process-boundary gaps take precedence over
  low-value line coverage.
- Existing global thresholds never decrease, and exclusions or allowlists never expand.
- Any remaining shortfall is quantified by metric and assigned an explicit disposition.

## Corrections to the initial audit

The initial coverage report identified useful risk areas but overstated several missing-test claims.
Execution must begin from these corrections rather than duplicating tests.

- `server/src/accounts/conformance/accountFlows.conformance.test.ts` already covers invitation
  admission, compensation and failed compensation, post-claim completion failure, replay and
  payload mismatch, reset authority/replay/expiry/capacity, revocation lock interactions, known
  identity errors and unknown reset/revocation outcomes. The server coverage config excludes this
  isolated suite, although `test:account-flows` runs it separately. These cases are reporting blind
  spots unless the evidence phase proves a narrower missing branch.
- `server/src/app.masquerade.test.ts` already provides substantial integration coverage for start,
  end, replacement, self/inactive/non-admin targets, cross-account projection, authority loss,
  membership removal, expiry, sign-out and revocation. Only missing route-adapter branches belong
  in this programme.
- `shared/src/account/policy.test.ts` checks the published four-argument function arity, not the
  number of supported actions. Preserve that assertion while adding dispatcher behaviour tests.
- Root coverage includes `shared/src/**/*.ts`; the shared package is not absent from enforcement
  merely because its standalone test command has no threshold.
- `server/src/boot/serverRuntime.ts` is an uncovered composition seam. Shutdown and signal helpers
  already have their own tests and must not be duplicated.
- The zero-file checker intentionally detects wholly untested executable files. Any per-file floor
  is a separate policy decision, not a defect fix to smuggle into a test packet.

## Execution contract

Every implementation assignment is dispatched as a self-contained packet to a low-reasoning
implementation worker. The coordinator supplies the exact pinned base, branch and worktree.

### Fixed boundaries for every worker

- Edit only the packet's **Writable files**. Production files are read-only unless a later,
  separately approved defect packet explicitly names them.
- Do not change exported types, wire fields, authorization policy, schema, migrations, database
  fixtures, dependencies, coverage configuration or thresholds.
- A test exposing a probable production defect is `BLOCKED`: report the exact failing case and the
  smallest proposed production fix. Do not weaken the assertion or alter production behaviour.
- Keep helpers local to the assigned test file. Do not create shared test infrastructure.
- Use existing complete fixtures and types. New invented people follow the repository's DC/Marvel
  naming rule. Do not add broad unsafe casts merely to make mocks compile.
- Do not add exclusions, allowlist entries, skipped/todo tests, coverage-ignore comments,
  denominator reductions or import-only tests.
- Do not extract or export private production functions for testing.
- Work in a fresh branch and sibling worktree; commit with `git commit -s`. Do not push, merge,
  rebase, stash, reset or edit another worker's worktree.
- Inspect the staged diff and commit only writable paths. Finish with `DONE` or `BLOCKED`, commit
  SHA, base SHA, changed paths, new versus moved test counts, exact checks/results and residual
  uncovered cases.
- After two failed focused correction attempts, stop and report the evidence. Do not redesign the
  packet.

### Standard worker validation

The coordinator replaces every placeholder with exact paths before dispatch. Node must be 24 or
newer. Frontend direct tests/typechecks run after Paraglide compilation.

```sh
node --version
pnpm run paraglide:compile
pnpm exec vitest run <root-test-paths>
pnpm exec tsc -b
pnpm exec eslint <touched-test-directories> --max-warnings 0
pnpm exec prettier --check <writable-files>
```

For server packets:

```sh
node --version
pnpm --filter capacitylens-server exec vitest run <server-relative-test-paths> --config vitest.config.ts --pool=forks --no-file-parallelism
pnpm --filter capacitylens-server run type-check
pnpm exec eslint <root-relative-touched-test-directories> --max-warnings 0
pnpm exec prettier --check <writable-files>
```

Shared packets also run:

```sh
pnpm --filter @capacitylens/shared run type-check
```

## P0: Refresh and classify evidence

**Owner:** coordinator. **Dependency:** none. **Writes:** evidence updates in this plan only.

Read `vite.config.ts`, both server Vitest configs, `server/package.json`,
`server/scripts/run-unit-shard.mjs`, `scripts/check-file-coverage.mjs`,
`scripts/gate-commands.mjs`, and every relevant source/test pair. Run coverage commands serially so
their output directories cannot collide:

```sh
node --version
pnpm run coverage
pnpm --filter capacitylens-server run test:coverage
```

Measure the excluded account-flow suite separately. Confirm the installed Vitest CLI accepts these
arguments before recording the command as evidence:

```sh
pnpm --filter capacitylens-server exec vitest run src/accounts/conformance/accountFlows.conformance.test.ts --config vitest.config.ts --pool=forks --no-file-parallelism --coverage --coverage.include='src/accounts/flows/**/*.ts' --coverage.reporter=text-summary --coverage.reporter=lcov --coverage.reportsDirectory=coverage-account-flows
```

Do not add or average percentages from separate reports. For every audit item record one
disposition: `missing test`, `covered outside headline report`, `uncovered composition boundary`, or
`policy/documentation issue`.

**Acceptance criteria**

- App and server statements, branches, functions and lines are recorded with revision, date, Node
  version and exact command.
- Existing-test citations are mapped to the relevant production branches.
- Residual account-flow cases are confirmed before Tasks 7–9 are dispatched.
- Threshold failure is evidence, not permission to edit thresholds.

### P0 evidence record

Recorded 2026-09-09 at revision `3c24277072398ca5b18e75cf0a2bcac28eb17b81` with Node
`v24.19.0` and pnpm `11.4.0`.

| Report                         | Exact command                                                                                                                                                                                                                                                                                                                                      |             Statements |             Branches |            Functions |                  Lines | Result                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------: | -------------------: | -------------------: | ---------------------: | -------------------------------------------------------- |
| App and shared headline        | `pnpm run coverage`                                                                                                                                                                                                                                                                                                                                | 94.50% (12,142/12,848) | 89.46% (7,861/8,787) | 95.31% (3,522/3,695) | 96.47% (10,552/10,938) | 204 files and 3,767 tests passed; zero-file check passed |
| Server headline                | `pnpm --filter capacitylens-server run test:coverage`                                                                                                                                                                                                                                                                                              |   89.96% (7,996/8,888) | 82.86% (4,728/5,706) | 93.95% (1,926/2,050) |   92.14% (7,188/7,801) | 95 files and 1,793 tests passed                          |
| Account flows, separate report | `pnpm --filter capacitylens-server exec vitest run src/accounts/conformance/accountFlows.conformance.test.ts --config vitest.config.ts --pool=forks --no-file-parallelism --coverage --coverage.include='src/accounts/flows/**/*.ts' --coverage.reporter=text-summary --coverage.reporter=lcov --coverage.reportsDirectory=coverage-account-flows` |       84.53% (328/388) |     67.64% (115/170) |      85.21% (98/115) |       86.74% (314/362) | One file and 44 tests passed; CLI arguments accepted     |

The account-flow figures are an isolated measurement of a suite excluded from the server headline
report. They are not combined with or averaged into the server figures.

#### Gap dispositions

| Item                                    | Disposition                                                  | Existing evidence or confirmed residual                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 1, OAuth callback redirect         | Missing test                                                 | No test calls `createErrorRedirect`; all listed validation, trust and storage-failure branches remain in scope.                                                                                                                                      |
| Task 2, permission races                | Missing test                                                 | Existing `PermissionProvider.test.tsx` cases cover initial pending/failure, refresh and generation invalidation, but not cross-account stale completion/rejection, immediate fail-closed state or malformed/absent membership results.               |
| Task 3, scoped data                     | Missing test                                                 | `multitenancy.test.ts` exercises direct scoping for clients and projects only; hook behaviour, all collections and projection-reference stability remain in scope.                                                                                   |
| Task 4, identity policy and guards      | Missing test                                                 | `policy.test.ts` covers lower-level standing and preserves the four-argument arity assertion, but not the action dispatcher. The deployment-profile and SSO-reason runtime guards lack direct positive and negative tests.                           |
| Task 5, SSO readiness parser            | Missing test                                                 | No test directly exercises `parseWorkspaceReadiness` or `resolveReadinessMemberLabel`.                                                                                                                                                               |
| Task 6, focus recovery                  | Missing test                                                 | No test directly exercises `restoreFocus`.                                                                                                                                                                                                           |
| Task 6, scheduler view                  | Uncovered composition boundary                               | Toolbar and grid have individual tests, but no test mounts their real composition and asserts user-facing output from both.                                                                                                                          |
| Tasks 7–9, account flows                | Covered outside headline report, with residual missing tests | The isolated conformance suite covers the cases cited below. Only the confirmed residuals are dispatched.                                                                                                                                            |
| Task 10, masquerade adapter             | Missing test                                                 | `app.masquerade.test.ts` covers the authentication integration, but the listed route-adapter validation, fallback, race and audit-failure branches remain.                                                                                           |
| Task 11, server runtime                 | Uncovered composition boundary                               | Shutdown helpers have tests; `serverRuntime` wiring, startup cleanup and event forwarding do not.                                                                                                                                                    |
| Task 12, import worker                  | Uncovered composition boundary                               | `runImportWorker.test.ts` covers queue/cancellation behaviour but imports the worker module only as a type, leaving its protocol boundary unexecuted.                                                                                                |
| Task 13, SSO cutover preflight          | Uncovered composition boundary                               | Lower-level readiness and selected real-database failures are covered; dependency mapping and fail-fast composition remain.                                                                                                                          |
| Task 14, v33 migration helper           | Missing test                                                 | Existing migration tests reach v33 indirectly but do not cover its missing-column refusal, nullable no-op or rebuild preservation branches.                                                                                                          |
| Task 14, v34 migration helper           | Covered outside the proposed new file                        | `db.migrate.test.ts` already proves v34 filtering, indexes, triggers, foreign keys, constraints and closures. No duplicate v34 case will be added.                                                                                                   |
| Coverage floors and zero-file allowlist | Policy/documentation issue                                   | Documentation reports app/shared floors of 84/78/85/86 while configuration enforces 92/87/92/94; server enforces 87/80/90/89 without an equivalent table. `SchedulerView` is one of three exact zero-file exceptions. Wave 6 owns these corrections. |

#### Confirmed account-flow residuals

- Task 7 retains all three candidates. Existing admission coverage stops before provisional creation;
  contract-error compensation tests do not exercise a non-contract fallback code; and no invite
  test makes terminal-outcome persistence fail while asserting preservation of the original claim
  and compensation evidence.
- Task 8 adds `VALIDATION_FAILED` and `UNSUPPORTED_CAPABILITY` beside the existing `NOT_FOUND`
  no-ceremony case; a post-ceremony failure with ceremony-ID/no-token reconciliation metadata; a
  failed reservation or issuance followed by proof that capacity was released; and exactly-once
  durable completion and success audit. The changed-authority replay case is already covered by
  `rechecks current authority before replaying a write-once password-reset token` and will be cited,
  not duplicated.
- Task 9 retains successful sign-in tracking cleanup and audit, completed replay idempotency, the
  pre-revocation authority-failure compensated outcome, and terminal-persistence preservation. The
  post-start reconciliation-required branch is already covered by
  `records unknown reset and session-revocation outcomes for operator reconciliation` and will be
  cited, not duplicated.

### Integrated evidence record

Recorded 2026-09-09 at revision `33117d61b967008515dc01b7903d6d76562f31c7` with Node
`v24.19.0` and pnpm `11.4.0`, after Tasks 1–14 were integrated.

- App and shared headline: `pnpm run coverage`.
- Server headline: `pnpm --filter capacitylens-server run test:coverage`.
- Account flows, separate report:
  `pnpm --filter capacitylens-server exec vitest run src/accounts/conformance/accountFlows.conformance.test.ts --config vitest.config.ts --pool=forks --no-file-parallelism --coverage --coverage.include='src/accounts/flows/**/*.ts' --coverage.reporter=text-summary --coverage.reporter=lcov --coverage.reportsDirectory=coverage-account-flows`.

| Report                         |             Statements |             Branches |            Functions |                  Lines | Result                                                    |
| ------------------------------ | ---------------------: | -------------------: | -------------------: | ---------------------: | --------------------------------------------------------- |
| App and shared headline        | 94.66% (12,163/12,848) | 89.74% (7,886/8,787) | 95.45% (3,527/3,695) | 96.58% (10,564/10,938) | 209 files and 3,844 tests passed; zero-file check passed  |
| Server headline                |   91.05% (8,093/8,888) | 83.96% (4,791/5,706) | 94.82% (1,944/2,050) |   93.18% (7,269/7,801) | 101 files and 1,845 tests passed                          |
| Account flows, separate report |       86.59% (336/388) |     71.17% (121/170) |     87.82% (101/115) |       88.67% (321/362) | One isolated file and 56 tests passed; not combined above |

Every headline metric improved from P0. The account-flow report also improved in every metric and
remains separate because its denominator is intentionally excluded from the server headline report.
One new integrated sample is insufficient evidence of the repeated stable headroom required by the
standing ratchet policy, so the configured thresholds remain unchanged.

The remaining distance from complete coverage is recorded for transparency, not as a 100% target:

| Report                         | Statements shortfall | Branches shortfall | Functions shortfall | Lines shortfall |
| ------------------------------ | -------------------: | -----------------: | ------------------: | --------------: |
| App and shared headline        |        5.34 pp (685) |     10.26 pp (901) |       4.55 pp (168) |   3.42 pp (374) |
| Server headline                |        8.95 pp (795) |     16.04 pp (915) |       5.18 pp (106) |   6.82 pp (532) |
| Account flows, separate report |        13.41 pp (52) |      28.83 pp (49) |       12.18 pp (14) |   11.33 pp (41) |

Tasks 1–14 add regression coverage for every confirmed missing behaviour and composition boundary.
The existing changed-authority password-reset replay, post-start session-revocation reconciliation,
and v34 migration recreation tests remain the cited evidence for the cases deliberately not
duplicated. `SchedulerView` now has meaningful composition coverage, so its exact zero-file
allowlist entry is removed in Wave 6. The remaining zero-file entries are unchanged and explicit.

## Test packets

### Task 1: OAuth callback error redirect

**Writable files:** `server/src/authConfig/errorRedirect.test.ts` (new).

Use `createErrorRedirect` directly with a mock `readVerificationValues`. Do not mock `node:crypto`
or rewrite the URL policy.

Required cases:

- Missing and empty state return an independent fallback URL without reading storage.
- A fixed SHA-256 base64url identifier is supplied to storage; do not calculate the expected value
  with the production hash operation as the only oracle.
- Null/empty results, malformed JSON, JSON `null`, state mismatch, missing/non-string `errorURL`,
  invalid/relative URLs and untrusted origins fall back.
- Trusted URLs containing a username or password are rejected.
- An invalid earlier row followed by a valid matching trusted row selects the latter and preserves
  its path and query.
- Storage failures surface rather than silently redirecting.

**Focused test:** server Vitest for `src/authConfig/errorRedirect.test.ts`.
**Acceptance:** all listed branches assert the returned URL and storage interaction.

### Task 2: Permission response races

**Writable files:** `src/auth/PermissionProvider.test.tsx`.

Use the existing provider, probe and store setup plus local deferred promises. Avoid timing sleeps;
use `act`, explicit promise resolution and `waitFor`.

Required cases:

- Resolve account A as owner, switch to B, and immediately observe fail-closed Viewer state in both
  context and store.
- Hold A's masquerade status, switch to B, then resolve A; it must neither publish A's role nor
  adopt stale masquerade state.
- Hold A's directory result, switch to B, resolve B and then A; B remains authoritative.
- A stale A rejection cannot overwrite B's resolved role.
- An active account absent from the returned membership list, and malformed roles, fail closed. A
  complete authoritative membership list may clear `activeAccountId`; assert the documented result.
- Off/demo modes make no permission network request. A null active account remains the documented
  null/not-applicable permission state and also makes no request.

**Focused test:** root Vitest for `src/auth/PermissionProvider.test.tsx`.
**Acceptance:** assertions cover context and store state, not fetch counts alone.

### Task 3: Scoped-data isolation and reference stability

**Writable files:** `src/store/useScopedData.test.tsx` (new).

Exercise both exported imperative resolvers and hooks rendered against the real store.

Required cases:

- A two-account fixture yields only selected-account rows in every scoped entity collection.
- Null account returns stable empty data.
- Identical data/account inputs reuse a reference; A→B→A reuses A; a new data object produces a
  new projection.
- `useScopedData` changes accounts without retaining stale rows.
- `useActiveScopedData` removes archived and soft-deleted rows according to shared lifecycle rules.
- `useInactiveScopedData` retains raw scoped inactive rows.
- An unrelated store change preserves the projection reference.

**Focused test:** root Vitest for `src/store/useScopedData.test.tsx`.
**Acceptance:** tests prove both tenant isolation and `useSyncExternalStore` stability; production
cache design and fixture freezing remain unchanged.

### Task 4: Identity policy and shared runtime guards

**Writable files:** `shared/src/account/policy.test.ts`,
`shared/src/account/conformance.test.ts`, `shared/src/account/ssoCutover.test.ts` (new).

Required cases:

- Every supported identity action is allowed with sufficient standing in all target workspaces.
- A missing workspace role or insufficient role in any workspace denies the action.
- Admin cannot administer another workspace's owner; owner can.
- Self-operation requires at least one target membership.
- An unknown runtime action is denied even for self or sufficient authority.
- The existing four-argument arity assertion remains.
- The deployment-profile guard accepts every published literal and rejects null, undefined,
  non-strings, unknown strings and case variants.
- The SSO-reason guard accepts every published reason and rejects invalid runtime values.

Expected results must be independent constants, not another production policy helper.

**Focused tests:** root Vitest for the three writable files, then shared typecheck.
**Acceptance:** all exported runtime discriminators and the action dispatcher have positive and
negative behavioural coverage.

### Task 5: SSO readiness transport parser

**Writable files:** `src/components/settings/ssoReadiness.test.ts` (new).

Build one valid payload, then table-drive one mutation at a time.

Required cases:

- Valid payloads and nullable identity fields are accepted.
- Invalid top-level shape, booleans, provider kind/experimental flag, role/reason, nested
  collections and repair coordinates are rejected independently.
- Malformed member issue and global issue fields are rejected independently.
- Member labels fall back from email to display name to principal ID.
- Preserve current nullish and empty-string semantics; do not invent stricter transport rules.

**Focused test:** root Vitest for `src/components/settings/ssoReadiness.test.ts`.
**Acceptance:** malformed server data fails closed without duplicating the large MembersSection UI
suite.

### Task 6: Focus recovery and scheduler composition

**Writable files:** `src/components/common/focus.test.ts` (new),
`src/components/scheduler/SchedulerView.test.tsx` (new).

Required cases:

- A connected trigger regains focus.
- A detached or null trigger falls back to `<main>` and makes it programmatically focusable.
- Missing `<main>` does not throw.
- `SchedulerView` mounts the real toolbar and grid together and asserts user-facing content from
  both. Use existing application fixtures. Mock only unrelated external dependencies; do not mock
  every child to arbitrary test IDs and do not use a snapshot-only assertion.

**Focused tests:** root Vitest for both writable files.
**Acceptance:** `SchedulerView` has meaningful nonzero behavioural coverage. The coordinator, not
the worker, later considers removing its zero-file allowlist entry.

### Tasks 7–9: Account-flow residual branches

**Shared writable file:** `server/src/accounts/conformance/accountFlows.conformance.test.ts`.

These tasks are sequential and assigned to one worker at a time. Use the existing SQLite, identity
port, lock and replay harness. P0 decides which candidate cases are genuinely absent; never copy an
existing case merely to change the headline report.

#### Task 7: Invite signup residuals

Candidates subject to P0 confirmation:

- Provisional creation fails before a principal exists: compensated ledger, correct failure code,
  no compensation call.
- Non-contract errors receive the documented fallback code.
- Terminal persistence failure retains original claim/compensation failure evidence.

Do not duplicate existing successful compensation, double failure, committed claim or replay cases.

#### Task 8: Password reset residuals

Candidates subject to P0 confirmation:

- Parameterize known no-ceremony refusals across `NOT_FOUND`, `VALIDATION_FAILED` and
  `UNSUPPORTED_CAPABILITY`.
- A replay with changed authority cannot disclose a token.
- Failure after ceremony creation records reconciliation metadata containing the ceremony ID and no
  plaintext token.
- Failed reservation/issuance releases reserved capacity.
- Persisted and audited outcomes occur exactly once.

#### Task 9: Session revocation residuals

Candidates subject to P0 confirmation:

- Successful completion clears tracked sign-in and records successful audit.
- Completed replay does not revoke twice.
- Authority failure before revocation versus failure after revocation starts produces compensated
  versus reconciliation-required outcomes.
- Terminal persistence failure retains the original failure evidence.

**Focused test for each task:** isolated `accountFlows.conformance.test.ts` under the normal server
config with serial forks. Do not rerun full coverage from a worker worktree.

### Task 10: Masquerade route-adapter edges

**Writable files:** `server/src/routes/masqueradeRoutes.test.ts` (new).

Read `server/src/app.masquerade.test.ts` first. Use Fastify injection with explicitly injected route
dependencies and the real registry where practical.

Required cases:

- Malformed/empty target body, missing session, and auth-off status distinctions.
- Null expiry produces service unavailable.
- Target-summary fallback and status results for ended records or null roles.
- Malformed end token/reason.
- Repeated valid end returns 204 without duplicate audit.
- A registry start race returns conflict.
- Audit failure surfaces and does not permit an unauthorized transition.

**Focused test:** server Vitest for `src/routes/masqueradeRoutes.test.ts`.
**Acceptance:** cover adapter-only branches without recreating the existing authentication
integration suite.

### Task 11: Server runtime composition

**Writable files:** `server/src/boot/serverRuntime.test.ts` (new).

Mock app, audit, backup, shutdown and refusal dependencies at module boundaries. Capture injected
process-event callbacks; never install global signal handlers or invoke real `process.exit`.

Required cases:

- Audit sink selection, optional backup startup/health, and setup warning.
- Successful listen and listen rejection forwarding.
- Signal and fatal-error forwarding.
- App or backup startup failure closes the database and disposes startup listeners.

**Focused test:** server Vitest for `src/boot/serverRuntime.test.ts`.
**Acceptance:** verify meaningful arguments and ordering without retesting shutdown internals.

### Task 12: Import worker protocol

**Writable files:** `server/src/importWorker.test.ts` (new).

Use module reset and dynamic import with mocked `node:worker_threads` and domain import behaviour.
Read `runImportWorker.test.ts` first and do not repeat queue/cancellation tests.

Required cases:

- Main thread installs no listener; a non-main thread without a port throws.
- Exactly one message listener is registered.
- Success response and arguments are forwarded correctly.
- `Error` and non-Error throws are serialized according to the existing protocol.
- Modules and mocks are restored after each case; no uncontrolled real worker is created.

**Focused test:** server Vitest for `src/importWorker.test.ts`.

### Task 13: SSO cutover preflight composition

**Writable files:** `server/src/cutoverPreflight.test.ts` (new).

Use dependency mocks rather than an operator database.

Required cases:

- Pending migrations refuse before context creation.
- Each current-schema assertion failure surfaces and prevents readiness evaluation.
- A valid context maps provider, identity, administrator and open-signup inputs correctly.
- Preflight performs no mutating operation.

**Focused test:** server Vitest for `src/cutoverPreflight.test.ts`.
**Acceptance:** composition and fail-fast ordering are covered; lower-level database tests remain the
source of database behaviour evidence.

### Task 14: Frozen migration helper branches

**Writable files:** `server/src/db/migrations/definitions.test.ts` (new).

Use a disposable in-memory SQLite schema. Never edit migration definitions, checksums, ledgers or
released fixtures.

Required cases:

- The v33 helper refuses when the expected column is missing.
- An already-nullable schema is a data-preserving no-op.
- Rebuilding a `NOT NULL` schema preserves rows, indexes and triggers and accepts null afterward.
- Add v34 recreation behaviour only if P0 proves it is uncovered by existing migration tests.

**Focused test:** server Vitest for `src/db/migrations/definitions.test.ts`.

## Parallel waves and dependencies

The physical limit is one coordinator plus three workers. A wave means implementation can proceed
in parallel because writable footprints are disjoint; coverage/full suites remain serial on one
machine. Tasks 7–9 serialize because they share a test file.

| Wave | Parallel assignments                    | Dependency                                  |
| ---- | --------------------------------------- | ------------------------------------------- |
| 0    | P0 evidence refresh                     | None                                        |
| 1    | Tasks 1, 2, 3                           | P0 dispositions                             |
| 2    | Tasks 4, 5, 6                           | Wave 1 integration checkpoint               |
| 3    | Tasks 7, 10, 11                         | P0-confirmed Task 7 cases                   |
| 4    | Tasks 8, 12, 13                         | Task 7 integrated                           |
| 5    | Tasks 9, 14                             | Task 8 integrated                           |
| 6    | Coordinator policy/documentation packet | All tests integrated and coverage refreshed |

At each checkpoint the coordinator verifies every signed commit against its writable footprint,
reviews all new assertions, integrates accepted commits, and runs affected focused tests. A worker
does not start the next task automatically.

## Coordinator policy and documentation packet

This is deliberately separate from behavioural tests.

**Coordinator-owned files only:** `vite.config.ts`, `server/vitest.coverage.config.ts`,
`scripts/check-file-coverage.mjs`, `src/fileCoverageGate.test.ts` if checker semantics change,
`docs-src/reference/development.md`, regenerated `docs/`, and this plan's evidence record.

Fixed decisions:

- Preserve current coverage denominators and isolated-suite exclusions during Tasks 1–14.
- Record excluded-suite measurements separately rather than combining incompatible reports.
- Correct documented coverage floors to match enforced configuration.
- Remove only the exact `SchedulerView` zero-file allowlist entry after Task 6 proves meaningful
  coverage.
- Ratchet global thresholds only from fresh integrated evidence; never lower them.
- A per-file ratchet requires an exact, measured file list and explicit exceptions. Do not impose a
  blanket 90% per-file rule.
- Do not add a redundant shared-package gate merely to duplicate root shared coverage.
- Repository-script coverage, `main.tsx`/`router.tsx` exclusions and report merging remain explicit
  follow-ups requiring their own bounded design.

Because this packet changes `docs-src/`, run `pnpm run docs:build` and commit regenerated `docs/`.

## Integrated validation and completion

After every accepted packet is integrated on one tree, run serially under Node 24 or newer:

```sh
pnpm run gate
pnpm run gate:server
pnpm run e2e
```

The app and server gates already run their coverage commands; reuse those reports rather than
immediately repeating them. Refresh the separate account-flow coverage report from P0 after the
gates. Only one E2E or coverage process may run at a time. Review the complete branch diff against
its base before submission.

The programme is complete when:

- every required case is tested or cited to an existing test;
- all focused and integrated validation passes;
- fresh metrics do not regress and any threshold increase is supported by stable headroom;
- low/no-coverage exceptions are explicit and no exception was added to make a gate pass; and
- remaining uncovered behaviour and percentage shortfall are recorded by metric without claiming
  that 100% is required or practical.

### Completion validation record

The completion gate ran at merged revision `2a63b11a08e93d470b0d9f683ee2bd99a35da8d6`
under Node `v24.19.0` on 2026-09-09:

- `pnpm run gate` passed, including 209 test files, 3,844 tests, the app/shared coverage report,
  the zero-file check, typechecks, lint, formatting, policy checks and production build.
- `pnpm run gate:server` passed, including 101 headline test files and 1,845 tests, the server
  coverage report, 56 isolated account-flow tests, three credential-durability tests, three
  migration-rehearsal tests, typecheck, lint, formatting and runtime build.
- `pnpm run e2e` passed all 257 Chromium, database-backed and authentication-backed scenarios.
- The separate account-flow coverage command recorded above was refreshed after the gates at the
  same revision: statements 86.59% (336/388), branches 71.17% (121/170), functions 87.82%
  (101/115), and lines 88.67% (321/362).

All required behaviours are covered by new regression tests or the existing citations recorded
above. No exclusions, allowlist entries, skips, coverage-ignore comments or denominator reductions
were added. The only allowlist change removes `SchedulerView`, and every measured metric improved
from P0.

## Risks and mitigations

| Risk                                                   | Mitigation                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Duplicate tests inflate cost without adding protection | P0 maps existing scenarios before flow work is dispatched.                             |
| Parallel agents edit the same large flow suite         | Tasks 7–9 are sequential and use one writable file.                                    |
| Coverage runs race over shared output                  | Coordinator runs all coverage commands serially with a separate flow-suite directory.  |
| Low-reasoning workers broaden production scope         | Each packet has exact writable files, fixed cases and a defect stop rule.              |
| Percentage chasing rewards trivial tests               | Security, tenancy, recovery and process boundaries are ordered before policy ratchets. |
| Tests pass under an unsupported runtime                | Node version is recorded and Node 24+ is a hard prerequisite.                          |
| A new test exposes a real defect                       | Worker stops; coordinator creates a separate, reviewed production-fix packet.          |
