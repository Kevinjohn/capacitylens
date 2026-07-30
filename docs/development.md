# Development

Use Node 24 from `.nvmrc` and pnpm from `packageManager`.

```bash
nvm use
corepack enable
pnpm install
```

## Run modes

```bash
pnpm run dev       # SQLite API :8787 + web :5173, seeded development data
pnpm run dev:demo  # web :5173, editable in-memory data, resets on reload
pnpm run dev:access # isolated password-auth role lab: API :8897 + web :5473
```

An empty `VITE_CAPACITYLENS_API` means same-origin server mode. A non-empty value must be an absolute
HTTP(S) origin without credentials, a path, query or fragment; surrounding whitespace and a trailing
slash are normalized. Only `VITE_CAPACITYLENS_DEMO=1` selects the in-memory adapter.
Invalid non-empty API or feedback-mailbox build values fail Vite configuration before bundling.

The in-memory demo has no real membership roles. To inspect the implemented Owner/Admin/Editor/
Viewer flows against the password-auth server, use the isolated access lab in
[`docs/onboarding-and-access.md`](onboarding-and-access.md#alpha-access-lab). It documents the
local-only credentials, prebuilt Studio North fixture and expected visibility matrix.

## Checks

```bash
pnpm run gate
pnpm run gate:server
pnpm run test:account-conformance
pnpm run e2e
pnpm run e2e:oidc
pnpm run rehearse:migrations
pnpm run coverage
pnpm run mutation
```

`gate` compiles translations, type-checks, lints with zero warnings, runs Vitest with enforced
coverage floors, rejects any new measured executable module with zero covered lines, and builds the
SPA. A short exact-file allow-list records existing zero-coverage debt; broad patterns are forbidden
so unrelated new files cannot inherit an exception.
The enforced browser/shared coverage floors are 84% statements, 78% branches, 85% functions and
86% lines. The main-entry raw and gzip byte budgets are defined beside the checker in
`scripts/check-build-size.mjs`; those checked constants, rather than prose copied here, are the
authoritative size limits.
The build also enforces a budget on the main JavaScript entry chunk; route-level lazy chunks remain
separate so authentication and settings code do not inflate first load unnoticed. The checker
requires exactly one JavaScript module entry in the built HTML and refuses to guess if another entry
is introduced; attribute order and quoting do not affect discovery.
Treat both sets of numbers as maintainer-owned regression boundaries, not automatic ratchets. When
a gate approaches or reaches one, add focused coverage, remove dead code, or preserve/split lazy
chunks before proposing a threshold change. Any intentional change must include the measured
before/after coverage or raw+gzip entry size and explain why the added tested behavior or first-load
cost is justified; changing a number only to restore green is not acceptable. Tighten a boundary
only when repeated gate results show stable headroom. The canonical policy is recorded in
`DECISIONS.md`.
`gate:server` checks the Node/SQLite workspace. GitHub CI divides ordinary server test files into
four parallel, bounded shards and launches each file in a fresh Vitest process. A file therefore
cannot leak native SQLite, authentication or AsyncLocalStorage state into the next file; each child
has a 90-second limit, while each shard has a four-minute circuit breaker. The
AsyncLocalStorage/lock-heavy account-flow conformance file runs alone in the independent
account-conformance process pool. The credential-onboarding crash harness and the process-heavy
migration regression likewise run separately in dedicated single-worker forks, so their intentional
child-process termination and native resource failures remain isolated and report their assertions
instead of stranding the complete unit run. Migration regression subprocesses have a 30-second
execution limit and a 45-second Vitest assertion budget, leaving enough room to report a child
timeout even when a shared runner is contended.
Default E2E runs demo, database-backed and password-auth flows in Chromium.
Both root and shared Vitest projects pin `TZ=UTC`; timezone-specific helper coverage must set its
zone deliberately in an isolated child process rather than inheriting a maintainer's machine.
`test:account-conformance` is the stable, independently reportable account-boundary check: it runs
the shared contract/policy tests, the same `IdentityPort` contract against Better Auth,
trusted-local and vendor-free implementations, the coordinator invariants, SQLite account-adapter
tests, profile validation and whole-tree architecture rules. `e2e:oidc` runs the real browser flow
against the digest-pinned Dex provider, including malformed and unavailable discovery paths. It
requires a working Docker installation and starts Dex in a local container for the duration of the
suite.
`rehearse:migrations` upgrades a released database fixture and verifies preservation, rollback and
recovery behavior.
Both gates also run the cryptographic implementation-path discovery check; a new primitive,
certificate/key path or TLS configuration must be reviewed into `docs/security/crypto-inventory.json`.
The hard gate scans tracked working-tree files. Crypto-like untracked files are listed separately as
ignored workspace artifacts, so a scratch file cannot make two checkouts of the same change produce
different pass/fail results; add an intended source file to Git before relying on the inventory gate.

The mutation configuration deliberately measures the pure shared/scheduler/browser helper layer.
React hooks are excluded because their effect and event orchestration is exercised by component and
cross-browser tests rather than isolated pure-function mutation. The mutation score is not evidence
for the Zustand store, React orchestration, or the Fastify/Better Auth implementation; those are
covered by focused unit/component tests, the server integration gate and E2E. Review surviving,
timed-out and uncovered mutants rather than accepting the aggregate score alone. The latest triage is recorded in
[`docs/security/mutation-review-2026-07-18.md`](security/mutation-review-2026-07-18.md).

Cross-browser commands:

```bash
pnpm run e2e:webkit
pnpm run e2e:firefox
pnpm run e2e:browsers
pnpm run e2e:all
```

Keep specs browser-agnostic. Screenshots and axe checks are the visual/accessibility oracles.
`e2e:all` runs Chromium plus the server-backed projects first, then WebKit and Firefox in isolated
Vite-only invocations; all three phases run even when an earlier phase fails.

CapacityLens supports current evergreen Chromium, Firefox and WebKit/Safari behavior represented by
the pinned Playwright release. The security baseline assumes HTTPS, Secure/HttpOnly/SameSite
cookies, CSP/frame enforcement, Fetch Metadata or Origin on unsafe cross-site browser requests, and
Web Crypto for encrypted offline access. Online mode remains usable when Web Crypto is unavailable,
but offline snapshot creation fails visibly instead of falling back to plaintext. Obsolete/plugin
browsers are unsupported; the application does not weaken headers or crypto for them.

User-text hygiene is single-sourced across the browser and server, but its Unicode property escapes
use each engine's bundled Unicode tables. Keep the supported browser matrix and Node version current
together: during a staggered engine upgrade, newly assigned code points can be conservatively
refused by the older runtime until both sides recognize their category.

## GitHub Actions policy

CapacityLens is a public repository. Pull requests, pushes to `main`, release tags and the documented
scheduled canaries run automatically; `workflow_dispatch` remains available for deliberate reruns:

```bash
gh workflow run gate.yml --ref main
gh workflow run e2e.yml --ref main
```

The `gate` workflow exposes independent jobs for workflow static analysis, DCO, application checks,
server checks, account conformance, released-database migration rehearsal and the production
dependency audit. The migration job also runs the process-heavy migration regression tests in an
isolated single-worker pool; both migration phases and the ordinary server unit phase have bounded
step runtimes so a leaked native handle cannot consume the complete job timeout. Independent jobs
run even when another category fails, avoiding a red application test hiding an account, migration
or dependency result. Coverage is uploaded when the repository has a `CODECOV_TOKEN` secret.

### Server tests that pass but do not exit

Treat process exit as an assertion. The characteristic failure is a list of green test files or
passing assertions followed by silence until GNU `timeout` returns 124; an inner child terminated by
SIGTERM commonly reports 143. GitHub's orphan-process cleanup may additionally name `MainThread`,
`esbuild` or another descendant. This is a lifecycle defect, not evidence that the suite needs a
larger timeout.

The ordinary server runner discovers test files under `server/src`, removes the three deliberately
isolated suites, sorts the remainder, distributes them across four shards and launches one fresh
Vitest process per file. To inspect or reproduce the same boundary:

```bash
pnpm --filter capacitylens-server test:unit-shard -- 3/4 --list
pnpm --filter capacitylens-server test:unit-shard -- 3/4
pnpm --filter capacitylens-server exec vitest run src/example.test.ts --pool=forks --no-file-parallelism
```

Start with the last announced filename and inspect every owned Fastify instance, SQLite connection,
timer, process signal listener and spawned child. Use `registerServerFixtureCleanup()` for ordinary
app/database fixtures. Subprocess tests must bound the child itself and avoid captured stdio pipes
when a compiler or other descendant can inherit them; temporary-file capture is the established
entrypoint-test pattern. A process-heavy test that intentionally exercises termination may receive a
dedicated required job, but passing assertions must never be manufactured with forced exits, weaker
cleanup, thread-pool reuse or a larger outer timeout.

The `e2e` workflow runs cross-browser behavior and strict OIDC/Dex conformance as independent jobs.
Each Playwright phase writes a distinct HTML report, JUnit result and trace directory; failed jobs
retain those artifacts for seven days, and the OIDC artifact includes timestamped Dex logs. Docker
Compose smoke tests remain separate so the README badges report independent status.

CodeQL runs on pull requests, `main` and its weekly schedule. OpenSSF Scorecard runs on `main` and
weekly. The security workflow performs full-history secret scanning, PR dependency review, source
SBOM generation, container vulnerability scanning, two OWASP ZAP baselines and tagged-release
provenance. The blocking ZAP scan boots the hardened posture — password authentication, required
MFA, scheduled backups and operator attestations, with credentials minted and masked per run — so a
finding there is a regression in the recommended configuration. A second, non-blocking job scans
the out-of-the-box default posture weekly and uploads its report as an artifact. Reviewed secret-scan
fixture findings are pinned in `.gitleaksignore`. See
`docs/security/security-review-2026-07-14.md` for assessment scope and residual controls.

The `main` ruleset requires every pull-request job that protects shipped behavior: all `gate` jobs,
both `e2e` jobs, the Docker production smoke, CodeQL analysis, secret scan, dependency review, source
SBOM, container vulnerability scan and the blocking hardened-posture ZAP baseline. Weekly-only,
tag-only and informational jobs are not required because they do not produce a status on every pull
request. Required checks must never be configured by a display name that no current PR workflow
emits; update the ruleset in the same change whenever a workflow or job name changes.

The coverage badge needs a Codecov project and a repository secret named `CODECOV_TOKEN`; uploads
are deliberately skipped until that secret exists. Uploads are best-effort because the required
local gate already enforces coverage thresholds and must not depend on Codecov availability.
Scorecard needs `publish_results: true` and its OIDC permission, which are configured in
`.github/workflows/scorecard.yml`.

Dependabot's monthly npm, GitHub Actions and Docker updates remain enabled; pnpm is updated from `/`
because the root workspace owns the shared lockfile.

## Repository map

- `shared/src/types/entities.ts` — canonical data model.
- `shared/src/domain/` and `shared/src/lib/` — environment-independent rules.
- `src/store/useStore.ts` — client orchestration and history.
- `src/data/` — persistence, in-memory demo and opt-in offline cache.
- `src/components/scheduler/` — grid/view-model.
- `server/src/app.ts` — HTTP boundary and authorization.
- `server/src/tenantStore.ts` — account-scoped whole-slice and targeted lifecycle storage boundary.

Lifecycle archive, unarchive and soft-delete use owned entity-level writes through `TenantStore`;
purge uses targeted SQLite cascades and restamps only surviving rows whose nullable relationship was
cleared. Do not route a single lifecycle action through whole-slice replacement: synchronous SQLite
would otherwise make its latency and write amplification proportional to every row in the tenant.

Shared interactive validation failures use `DomainError` and a stable `DomainErrorCode`; fallback
English is safe for logs and version skew, but browser surfaces translate the code rather than
matching or rendering that prose. Server `ValidationError` preserves a shared code in HTTP 400
responses. Add a code, fallback and Paraglide mapping together whenever a new domain rule rejects a
caller.

- `server/src/tables.ts` — schema/column specification.

Server-mode persistence refreshes a visible active-company slice every 60 seconds and on focus or
visibility return (with a shared 30-second throttle). All paths reuse the account-switch refresh
orchestrator so the rendered slice and adapter diff snapshot advance atomically; failed saves defer
ordinary refreshes until their optimistic state can be preserved or reconciled.

Page-teardown persistence preflights the aggregate browser keepalive budget before dispatching any
request. The estimate includes every batch and lifecycle-archive body plus a conservative per-request
allowance for request metadata; do not validate sibling keepalives independently because browsers
apply their quota across all in-flight keepalive requests for the page.

Batch validation assembles a request-local projection from only the account slices named by its
operations, then advances that projection in operation order through per-table id and reverse-FK
indexes. Account import likewise reads only the target slice before replacement. Do not replace the
batch indexes with repeated `findIndex`/`map`/`filter` rebuilds, or either read path with whole-
database `loadState()`: relationship validation needs complete target slices, not quadratic copies
or unrelated tenant rows. When a new AppData foreign key is added, update the relationship graph in
`server/src/batchProjection.ts` alongside the table definition and its cascade-parity tests.

The 5,000-operation atomic batch cap is also an event-loop availability bound. The inclusive server
integration test applies 5,000 real updates and requires the handler to finish within four seconds
under the supported Node 24 gate, below the packaged container healthcheck's five-second timeout.
Do not split the transaction or add an in-process queue as a latency workaround: splitting breaks
ordered atomicity, while a queue cannot preempt a synchronous SQLite turn. If the boundary test
exceeds its budget, reduce both `MAX_BATCH_OPS` and the client's `MAX_OPS_PER_BATCH` together or move
the database work to a genuinely isolated execution model.

Read `AGENTS.md`, `DECISIONS.md` and `DEFENSIVE-CODING.md` before broad changes.

## Database migrations

The portable AppData/export format uses `EXPORT_SCHEMA_VERSION` in `shared/`. The physical SQLite
file independently uses `DB_SCHEMA_VERSION` and `PRAGMA user_version` in `server/src/db.ts`. Never
reuse one number for the other: an export-only change must not block an otherwise compatible server
rollback, and a control/auth database change must not escape downgrade refusal.

Database v8 is the explicit-runner baseline. An immutable ordered migration advances one version
inside one `BEGIN IMMEDIATE` transaction and stamps `user_version` plus the CapacityLens
`application_id` in that same commit. The same transaction inserts a row into
`capacitylens_schema_migrations` containing the version, name, SHA-256 definition checksum and
application timestamp. Startup validates the complete ledger before planning writes and refuses a
missing, reordered, renamed or checksummed-different migration. `SCHEMA_SQL` creates fresh
databases; already-released files advance through migrations. Shape introspection remains a
post-migration assertion and a v0-v7 baseline repair, not the mechanism for silently applying new
fields. That assertion verifies the TABLES write contract (declared types, nullability and id
primary keys) and rejects unknown required columns or constraints that could reject a valid entity
write. Nullable or defaulted extension columns remain forward-compatible because every product
write names its columns explicitly.

Database v21 indexes every scoped table by `accountId`; v23 separately indexes every non-account
foreign-key child column so SQLite parent deletes and cascades do not scan whole child tables.
Startup verifies the owner, column, uniqueness, collation and direction of both index sets.

For every persisted change:

1. Update shared types and full fixtures where the portable shape changed.
2. Update `TABLES` and fresh-database DDL.
3. Add the next immutable database migration and a complete checksum definition; never edit or
   delete a migration that shipped. A changed definition is intentional startup incompatibility,
   not a repair mechanism—restore the released migration and add a new version instead.
4. Make required fields additive first, backfill and validate, then rebuild to enforce `NOT NULL`.
   A rename/rebuild must preserve indexes, triggers, constraints and foreign keys explicitly.
5. Update import sanitisation independently of the physical migration.
6. Before changing migration code, generate a sanitised `.db` fixture with the released build.
   Keep one fixture per shipped top-level database version and auth shape under
   `server/src/fixtures/databases/`; tests copy it before opening and never migrate it in place.
   Intermediate migration steps that never appeared as a released build's `user_version` do not
   get synthetic fixtures; the next released fixture exercises those steps in their real sequence.
7. Assert data preservation, fresh/migrated schema equivalence, idempotent reopen, transaction
   rollback/retry, `quick_check`, `foreign_key_check`, future-version refusal and auth convergence.
8. Add operator-facing migration/rollback notes to `CHANGELOG.md` and the operator docs.

Before releasing any schema-bearing build, run the automated rehearsal. With no argument it uses
the committed password-auth v7 fixture:

```bash
pnpm run rehearse:migrations
```

Also run it against a representative long-lived installation. The command uses SQLite's online
backup API and never opens the source for writes. It remaps ids, replaces names/notes/emails and
credential/session/invite/MFA material, enables secure deletion and vacuums the temporary copy
before testing it. Unknown tables fail closed until their sensitive columns are reviewed. Temporary
artifacts are deleted by default:

```bash
pnpm run rehearse:migrations -- --source /path/to/capacitylens.db
```

The rehearsal verifies the happy-path migration, pre-migration snapshot equivalence, row-count and
integrity preservation, checksum-ledger convergence, idempotent reopen, rollback after an injected
`ENOSPC`, and WAL recovery after killing a process with the real migration transaction open. Use
`--keep` only in a protected development environment when the anonymised artifacts are needed for
diagnosis; never commit an installation-derived database.

App-owned control tables share the application migration stream. Better Auth remains pinned and
owns its own tables; startup reruns its introspection migration and then verifies that no table or
column work remains before accepting traffic. Every Better Auth upgrade needs a password-mode
fixture containing synthetic users, credential accounts and sessions. A dependency/plugin upgrade
that can change Better Auth's desired schema must also advance `DB_SCHEMA_VERSION` (a named marker
migration is sufficient when no app-owned SQL is needed), so the previous server refuses the file
before the library-owned DDL runs.

Pre-migration snapshot tests fault-inject permission, file-sync, rename and directory-sync failures
and prove initialization remains uncalled. The normal migration rehearsal exercises the real Node
24 filesystem primitives, but destructive power-loss behavior still depends on the host filesystem,
mount options and storage hardware and requires an operator-level storage test where warranted.

Database v17 adds `capacitylens_audit_outbox`. Product routes enqueue their data-minimised audit
record inside the mutation transaction, then synchronously drain in sequence order. The file sink
fsyncs before the outbox delete and recognizes a stable `auditId`, so tests must cover rollback,
restart recovery, append/delete replay and sink-failure retention whenever this pipeline changes.

Database v18 adds `capacitylens_sync_sessions` and `capacitylens_sync_row_provenance`. Browser sync
batches carry one random per-page session id and a monotonic sequence. The server rejects a lower
sequence that arrives late and uses the exact hashed row result of the preceding same-session batch
to distinguish a safe successor from an intervening external edit. Ordered browser batches always
enforce these stale preconditions, even in the explicit single-writer concurrency mode; direct API
writes retain their configured optimistic-concurrency policy. Ordering rows expire after seven days.
For an existing-row PUT or batch PUT, `updatedAt` is an exact server-revision precondition: omission,
malformation, an older value or a caller-authored future value returns 409. A partial PATCH may omit
the precondition for compatibility, but any supplied value must match exactly.
PATCH is a merge: omitting a field preserves its stored value, explicit `null` clears an optional
column, and explicit `null` for a required column is rejected with 400. Optional values repaired by
the shared import sanitizer normalize to absence consistently before SQLite encoding.
Row provenance carries its owning account explicitly and is removed as part of workspace erasure.
Current servers return one server-owned revision for each PUT table/id and no others; a superseded
ordered batch returns an empty revision list. During a rolling-version window the client also
accepts a successful legacy receipt with missing or partial revision metadata, logs the skew and
continues without the unavailable timestamp translations. The `ok` result remains mandatory and a
present `applied` count must still equal the submitted operation count.

Database v19 installs product-table triggers for every parent/child tenant relationship. They reject
cross-company references on insert or update, make scoped `accountId` values immutable, and are
verified (including their enforcement bodies) on every boot. The migration refuses a pre-existing
cross-company edge rather than guessing which tenant label or reference to repair; use the verified
pre-migration snapshot and an explicit operator repair before retrying.

Database v20 moves the app-owned `capacitylens_bootstrap_claim` table into the immutable migration
ledger. It upgrades only the two definitions emitted by older CapacityLens builds, clears their
unauthenticated five-minute claim lease, and preserves an already-current tokenized lease. Any
other shape fails closed after the normal pre-migration snapshot instead of receiving speculative
DDL. Runtime auth setup only verifies the exact table definition and expires stale leases.

Database v21 adds one non-unique `accountId` index to every tenant-scoped product table. Startup
verifies each index's owning table, key column, direction, collation, uniqueness and partial-index
flags. The query-plan regression requires both scoped reads and whole-slice deletes to use these
indexes, so one company's synchronous work does not scale with unrelated companies' rows.

Database v22 repairs any built-in Internal client carrying an archive or deletion tombstone from
the historical legacy-id replacement path. It clears both lifecycle fields and advances the row's
revision so a repaired singleton is active and distinguishable from its pre-migration value. The
write boundary independently rejects any future replacement that would promote an inactive row.

Production startup validates pure configuration, opens without application DDL, plans the upgrade,
plans application-ledger and Better Auth schema work, and writes a verified
`capacitylens-pre-migration-vN-to-vM.db` rollback snapshot before applying anything. Scheduled
backups may remain disabled; this one-shot safety snapshot is mandatory for an existing on-disk
database that needs any of those migrations. It is not retention-pruned automatically; repeated
attempts for one version pair atomically refresh that one file.

CapacityLens supports coordinated restarts, not mixed-version writers. Do not add down migrations.
Rollback uses the old image and its matching pre-migration snapshot while the API is stopped. If
mixed-version/zero-downtime deployment is introduced later, schema changes must switch to an
expand → backfill/dual-read-write → contract sequence across releases.

## Persistence diagnostics

Server-mode Settings exposes process-local persistence counters for failed saves, retries,
reconciliations, superseded reloads, rebases and discarded edits, plus the current write-suspension
state. The counters intentionally contain no tenant values and reset whenever a fresh persistence
lifecycle attaches. Use them with the build stamp when reproducing save or reload failures; they are
diagnostic breadcrumbs, not durable telemetry or an operator health endpoint.

## Test data and generated files

Sample organisations and people must be fictional. Never copy production names, notes, domains or
ids into fixtures, screenshots or stories. Paraglide output, test reports, local databases and local
agent configuration are ignored and must not be committed. The only committed database files are
the sanitised released-schema artifacts under `server/src/fixtures/databases/`.

## Ports

The complete E2E matrix also uses web/API ports 5273, 5373 and 8887. Stop an existing dev stack
before E2E; Playwright intentionally refuses to reuse the demo/auth servers because persistence
flavour matters.
When a focused Playwright command explicitly names only ordinary core spec files (for example,
`pnpm exec playwright test e2e/timeoff.spec.ts`), the harness starts only the demo Vite server.
Unfiltered, directory-filtered, mixed and `.db`/`.auth`/`.oidc` selections retain the complete server
set unless an explicit scope flag selects a narrower supported matrix.
The access lab and strict-OIDC E2E harness both reserve web/API 5473/8897 and cannot run together;
stop the access lab before OIDC certification.

Development/test environment controls are intentionally separate from production configuration.
`API_PORT` belongs only to `scripts/serve-dist.mjs`; Playwright/package orchestration owns
`CAPACITYLENS_E2E_PHASE`, `CAPACITYLENS_WEBKIT`, `CAPACITYLENS_WEBKIT_ONLY`,
`CAPACITYLENS_FIREFOX`, `CAPACITYLENS_FIREFOX_ONLY`, `CAPACITYLENS_VITE_ONLY` and
`CAPACITYLENS_OIDC_E2E`. `CAPACITYLENS_REHEARSAL_URL` is the one operator-supplied test control: it
points the rehearsal browser project at the staged upgraded deployment. CI pins
`ACTIONLINT_VERSION`; update that pin alongside its download/checksum workflow review.
`CAPACITYLENS_E2E_PHASE` must contain only letters, numbers, underscores and hyphens; unset or empty
selects `default`. Invalid values fail configuration rather than aliasing two runs into one report
directory.
