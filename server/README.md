# CapacityLens server

The server is a Fastify API backed by Node's built-in `node:sqlite`. It imports the shared domain
core for sanitisation, integrity and migration rules, so browser and server behavior cannot drift.

```bash
pnpm --filter capacitylens-server start
pnpm run gate:server
```

Node 24 is required. The default database is `capacitylens.db`; set `CAPACITYLENS_DB=:memory:` only
for disposable tests.

## Boundaries

- App data is account-scoped and authorized from session membership.
- Auth, membership, invite and verification tables are server control data, not part of `AppData`.
- Writes are sanitised and validated, optimistic concurrency is always on, and batch/import
  operations are transactional.
- Audit records contain actor/entity/field names but not values.
- `/api/health` is public and rate-limit exempt so ordinary API traffic cannot starve the uptime
  probe; deep health uses a constant readiness query, while startup performs the full SQLite
  foreign-key integrity check.
- Unsafe browser requests enforce same-origin CSRF signals and all API responses are non-cacheable.
- Internal TLS is optional for a trusted same-host loopback proxy; Compose enables it automatically
  and nginx verifies the API service name without a plaintext fallback.
- Accepted sockets, scrypt and breached-password calls have finite process-wide queues/limits;
  multi-company deployments do not receive separate password-work reservations.

The authoritative environment register is `.env.example`. See the
[self-hosting guide](../docs-src/self-hosting/index.md),
[company sign-in guide](../docs-src/company-login/index.md) and
[incident procedures](../docs-src/self-hosting/incidents.md) for deployment and operations.

## Authentication

`SMALLSASS_ACCOUNT_MODE=off|password-only|sso-only|password-and-sso`. Named Google and Microsoft
providers are supported; GitHub remains experimental. `password-and-sso` requires at least one
configured provider, while `sso-only` requires Google or tenant-specific Microsoft. External
identities need verified email and an invitation, with an explicit bootstrap email allow-list for
the first identity. Provider configuration is fail-closed; incomplete credentials refuse startup.

Production password mode defaults to breached-password screening and supports opt-in required TOTP
MFA. Sessions retain a fixed twelve-hour lifetime and thirty-minute inactivity timeout. HTTPS
cookies use the host-only `__Host-` prefix. New credentials use a versioned OWASP-strength scrypt
profile; legacy Better Auth hashes are accepted only for compatibility. When MFA is required,
tenant operations are blocked until enrollment. A session no older than fifteen minutes is required
to transfer company ownership, reset another member's password, revoke another member's sessions,
delete a company, import or purge data, or link or repair an SSO identity. Other administrative
actions require the actor's role and MFA policy. Data export does not require a fresh session.

Production refuses auth-off unless `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1` explicitly accepts the
risk. That escape hatch is for trusted/local use, not an internet deployment.

## Persistence and backups

SQLite foreign keys and WAL mode are enabled. Use `CAPACITYLENS_BACKUP_DIR` for online snapshots;
never copy the live database file as a backup. Graceful shutdown drains pending snapshots before
closing SQLite.

Physical SQLite migrations are explicit, ordered and independent from JSON export migrations.
Startup validates a checksummed database-side migration ledger and refuses future database versions,
altered migration history and non-CapacityLens SQLite files. Before migrating an existing on-disk
file it writes and verifies a one-shot pre-migration rollback snapshot, using the configured backup
directory or otherwise the database directory. Rollback restores that snapshot while stopped and
runs the matching old image; down migrations and mixed-version writers are not supported. Run
`pnpm run rehearse:migrations` before schema-bearing releases; pass `--source /path/to/database.db`
to exercise a temporary anonymised snapshot of a representative long-lived installation.
