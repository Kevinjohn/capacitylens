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
- Writes are sanitised and validated, optimistic concurrency is on by default, and batch/import
  operations are transactional.
- Audit records contain actor/entity/field names but not values.
- `/api/health` is public and rate limited; deep health uses a constant readiness query, while
  startup performs the full SQLite foreign-key integrity check.
- Unsafe browser requests enforce same-origin CSRF signals and all API responses are non-cacheable.
- Internal TLS is optional for a trusted same-host loopback proxy; Compose enables it automatically
  and nginx verifies the API service name without a plaintext fallback.
- Accepted sockets, scrypt and breached-password calls have finite documented queues/limits.

The authoritative environment register is `.env.example`. Production deployment and operations
are documented in `docs/self-hosting.md`, `docs/authentication.md` and `docs/runbook.md`.

## Authentication

`CAPACITYLENS_AUTH=off|password|sso`. Password mode can also expose configured experimental social
or generic OIDC providers. External identities need verified email and an invitation, with an
explicit bootstrap email allow-list for the first identity. Provider configuration is fail-closed;
partial credentials or missing OIDC endpoints refuse startup.

Production password mode defaults to breached-password screening and supports opt-in required TOTP
MFA. Sessions retain a fixed twelve-hour lifetime and thirty-minute inactivity timeout. HTTPS
cookies use the host-only `__Host-` prefix. New credentials use a versioned OWASP-strength scrypt
profile; legacy Better Auth hashes are accepted only for compatibility. When MFA is required,
tenant operations are blocked until enrollment. Privileged actions always require a session no
older than fifteen minutes, and users/authorised administrators can revoke sessions immediately.

Production refuses auth-off unless `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1` explicitly accepts the
risk. That escape hatch is for trusted/local use, not an internet deployment.

## Persistence and backups

SQLite foreign keys and WAL mode are enabled. Use `CAPACITYLENS_BACKUP_DIR` for online snapshots;
never copy the live database file as a backup. Graceful shutdown drains pending snapshots before
closing SQLite.
