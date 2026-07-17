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

An empty `VITE_CAPACITYLENS_API` means same-origin server mode. A non-empty value overrides the API
origin. Only `VITE_CAPACITYLENS_DEMO=1` selects the in-memory adapter.

The in-memory demo has no real membership roles. To inspect the implemented Owner/Admin/Editor/
Viewer flows against the password-auth server, use the isolated access lab in
[`docs/onboarding-and-access.md`](onboarding-and-access.md#alpha-access-lab). It documents the
local-only credentials, prebuilt Studio North fixture and expected visibility matrix.

## Checks

```bash
pnpm run gate
pnpm run gate:server
pnpm run e2e
pnpm run coverage
pnpm run mutation
```

`gate` compiles translations, type-checks, lints with zero warnings, runs Vitest with enforced
coverage floors and builds the SPA.
The build also enforces a budget on the main JavaScript entry chunk; route-level lazy chunks remain
separate so authentication and settings code do not inflate first load unnoticed.
`gate:server` checks the Node/SQLite workspace. Default E2E runs demo, database-backed and
password-auth flows in Chromium.
Both gates also run the cryptographic implementation-path discovery check; a new primitive,
certificate/key path or TLS configuration must be reviewed into `docs/security/crypto-inventory.json`.

The mutation configuration deliberately measures the pure shared/scheduler/browser helper layer;
it is not evidence for the Fastify/Better Auth implementation, which is covered by the separate
server integration gate. Review surviving, timed-out and uncovered mutants rather than accepting
the aggregate score alone. The latest triage is recorded in
[`docs/security/mutation-review-2026-07-15.md`](security/mutation-review-2026-07-15.md).

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

## GitHub Actions policy

During pre-launch development the repository is private and local checks are the source of truth.
Push, pull-request and scheduled workflow events may appear in GitHub as **skipped**, but they do
not start a hosted runner. This prevents small development pushes and Dependabot pull requests
from repeatedly consuming the private-repository Actions allowance.

Run the complete remote gate deliberately from **GitHub → Actions → gate → Run workflow**, or:

```bash
gh workflow run gate.yml --ref main
```

A manual gate runs the code gates and production dependency audit. Cross-browser E2E and Docker
Compose smoke tests are separate workflows so their README badges report independent status. The gate also
uploads `coverage/lcov.info` to Codecov when the repository has a `CODECOV_TOKEN` secret. CodeQL and
Scorecard remain skipped while the repository is private because their public result services are not
enabled for this repository.

When the repository becomes public, the workflow conditions automatically restore:

- code gates for pull requests, pushes to `main`, release tags and the monthly canary;
- Chromium, Firefox and WebKit E2E for pull requests, pushes to `main`, release tags and its monthly canary;
- Docker Compose builds and production smoke tests for pull requests, pushes to `main` and release
  tags;
- CodeQL for pull requests, `main` and its weekly schedule.
- OpenSSF Scorecard for `main` and its weekly schedule.
- full-history secret scanning, dependency review, source SBOM, container vulnerability scanning,
  two OWASP ZAP baselines and tagged release provenance through `security.yml`. The blocking ZAP
  scan boots the hardened posture — password authentication, required MFA, scheduled backups and
  the operator attestations, with credentials minted and masked per run — so a finding there is a
  regression in the recommended configuration. A second, non-blocking job scans the out-of-the-box
  default posture on the weekly schedule and uploads its report as an artifact. Reviewed
  secret-scan findings (deliberately fake test fixtures) are pinned in `.gitleaksignore`.

The security workflow remains manually runnable while private and becomes automatic on its
documented public-repository events. See `docs/security/security-review-2026-07-14.md` for the
assessment scope and residual controls.

The coverage badge needs a Codecov project and a repository secret named `CODECOV_TOKEN`; uploads
are deliberately skipped until that secret exists. Scorecard needs `publish_results: true` and its
OIDC permission, which are configured in `.github/workflows/scorecard.yml`.

Standard GitHub-hosted runners are free for public repositories. Dependabot's monthly npm, GitHub
Actions and Docker updates remain enabled while private; pnpm is updated from `/` because the root
workspace owns the shared lockfile.

## Repository map

- `shared/src/types/entities.ts` — canonical data model.
- `shared/src/domain/` and `shared/src/lib/` — environment-independent rules.
- `src/store/useStore.ts` — client orchestration and history.
- `src/data/` — persistence, in-memory demo and opt-in offline cache.
- `src/components/scheduler/` — grid/view-model.
- `server/src/app.ts` — HTTP boundary and authorization.
- `server/src/tables.ts` — schema/column specification.

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
fields.

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
   Keep one fixture per shipped database version and auth shape under
   `server/src/fixtures/databases/`; tests copy it before opening and never migrate it in place.
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

Production startup validates pure configuration, opens without application DDL, plans the upgrade,
plans conditional app-owned and Better Auth schema work, and writes a verified
`capacitylens-pre-migration-vN-to-vM-*.db` rollback snapshot before applying anything. Scheduled
backups may remain disabled; this one-shot safety snapshot is mandatory for an existing on-disk
database that needs any of those migrations. It is not retention-pruned automatically.

CapacityLens supports coordinated restarts, not mixed-version writers. Do not add down migrations.
Rollback uses the old image and its matching pre-migration snapshot while the API is stopped. If
mixed-version/zero-downtime deployment is introduced later, schema changes must switch to an
expand → backfill/dual-read-write → contract sequence across releases.

## Test data and generated files

Sample organisations and people must be fictional. Never copy production names, notes, domains or
ids into fixtures, screenshots or stories. Paraglide output, test reports, local databases and local
agent configuration are ignored and must not be committed. The only committed database files are
the sanitised released-schema artifacts under `server/src/fixtures/databases/`.

## Ports

The complete E2E matrix also uses web/API ports 5273, 5373 and 8887. Stop an existing dev stack
before E2E; Playwright intentionally refuses to reuse the demo/auth servers because persistence
flavour matters.
