# Test coverage improvement plan

Status: documented proposal, prepared 2026-09-09. Implementation starts only when this plan is
selected for execution. Base reviewed: `135cc016a39f9ed6c7dc8ff363d6d1a37014c854`.

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
