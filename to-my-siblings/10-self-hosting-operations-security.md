# 10 — Self-hosting, operations and security

A self-hostable product is not complete when `docker compose up` works once. It needs a supported
topology, complete configuration register, backup/restore story, health signal, upgrade sequence and
incident procedure.

## Supported production shape

```text
Internet
   ↓ HTTPS
TLS reverse proxy / packaged nginx
   ├── / and static assets ──> immutable web container/dist
   └── /api/* ───────────────> private Fastify API
                                  ↓
                       persistent SQLite + audit
                                  ↓ online snapshots
                       persistent snapshot volume
                                  ↓ scheduled encrypted copy
                       separate host/account/region
```

Same-origin web/API is the default:

- simpler cookie security;
- meaningful restrictive CSP;
- no per-host SPA rebuild;
- no permissive CORS;
- one public health path;
- fewer proxy mistakes.

Never expose the API container around the proxy.

## Docker posture

CapacityLens's production containers demonstrate:

- separate web and API build targets;
- production dependencies only in the API image;
- unprivileged users;
- read-only root filesystems;
- dropped Linux capabilities;
- `no-new-privileges`;
- writable persistent volumes only where needed;
- digest-pinned base images;
- health check through the same-origin proxy;
- packaged security headers;
- request body limit aligned with server limits.

Copy the posture, then rename paths, images and health responses.

## Complete environment register

`.env.example` must list every variable the product reads, grouped by:

1. server runtime;
2. persistence/backups/audit;
3. auth and providers;
4. client build time;
5. process/runtime.

For each variable state:

- default;
- accepted type/values;
- whether exactly `1` means on;
- whether empty differs from unset;
- whether it is required in a mode;
- whether changing it needs restart or SPA rebuild;
- safe production posture;
- maximum/minimum bounds;
- secret-generation guidance.

Do not keep an undocumented “production env list” outside the repository.

## Production defaults and boot guards

The process should refuse configurations that are dangerous rather than log a hopeful warning:

- auth off under production unless an explicit risk-acceptance flag is set;
- destructive test reset under production;
- unknown auth mode;
- missing/short auth secret;
- missing/invalid public auth URL;
- non-loopback HTTP production auth URL;
- half-configured provider;
- SSO-only without generic OIDC;
- malformed OIDC endpoints/bootstrap list.
- password mode without mandatory MFA;
- production password mode with breached-password checking disabled;
- missing, invalid or zero production rate limit;
- production audit explicitly disabled;
- missing operator attestation for encrypted database/audit/backup storage;
- missing operator attestation for logically separate security-log forwarding.

Warn, rather than refuse, when context may make it legitimate:

- HSTS flag off because TLS may terminate at proxy;
- deliberately open signup;
- temporary bootstrap owner switch;
- operator-pinned bootstrap password.

Every refusal should state the exact corrective variable/action.

## Proxy security

- TLS terminates at a controlled proxy/load balancer.
- Proxy overwrites forwarding headers; it does not append untrusted values.
- Trust forwarded client IP only when the API is unreachable directly.
- CORS is same-origin by default; credentialed `*` is rejected.
- Invite/reset tokens are removed from access logs.
- Baseline headers include CSP, frame protection, nosniff and referrer policy.
- Add a restrictive Permissions Policy and `Cache-Control: no-store`/legacy `Pragma: no-cache` on
  all API/auth/error responses.
- HSTS is emitted only when public responses are truly HTTPS.
- Browser connect policy allows only the intended API/identity destinations.
- Request body limits agree at proxy and application.

## Health and observability

Provide unauthenticated `GET /api/health`:

- shallow: process is serving;
- optional deep: trivial DB read and audit degradation state;
- 503 when a required dependency is unusable.

Monitor it through the same public proxy users reach. A direct container check can be green while
nginx routing, TLS or headers are broken.

Logs:

- structured request logs in production when enabled;
- redact tokens/secrets and avoid field values;
- retain identifiers only under an explicit policy;
- audit domain mutations separately as actor/entity/field names, not values;
- create database, WAL/SHM, audit, snapshot-directory and snapshot files with owner-only permissions;
- optionally emit typed one-line audit envelopes to stdout for an external collector;
- treat “storage encrypted” and “security logs forwarded” flags as operator attestations, never as
  controls the application magically implemented;
- surface audit write degradation to the user/operator without rolling back the successful domain
  mutation unless the product requires hard audit atomicity.

Useful status interpretation:

- repeated 401/403: access/security signal;
- 409: conflict/illegal transition;
- 429: rate limiting;
- 5xx/deep health degradation: operator alert.

## Backup strategy

SQLite in WAL mode must be backed up with SQLite's online backup operation, not `cp` of the live DB.

Layers:

1. periodic online snapshots on the application host;
2. retention pruning;
3. scheduled encrypted copy to a separate failure domain;
4. monitoring of job success and newest usable snapshot age;
5. regular restore drill.

Database, audit and snapshot files use `0600` and their application-created directories use `0700`.
These permissions do not replace full-volume encryption, off-host access controls or an external
security-log destination.

An on-host snapshot is a convenient restore point, not disaster recovery.

Keep database, snapshots, environment and operational logs outside directories replaced by
deployments.

## Restore drill

Run before launch and after material storage changes:

1. stop API cleanly;
2. wait for process exit;
3. preserve live DB plus WAL/SHM for rollback;
4. copy a chosen snapshot to configured DB path;
5. remove stale sidecars;
6. start API;
7. verify deep health;
8. verify sign-in and tenant list;
9. inspect recent expected records;
10. perform one safe write;
11. record snapshot time, result and recovery duration.

An automated corruption/restore test proves core mechanics, not credentials, mounts or the operator's
ability to perform the drill.

## Upgrade process

1. Confirm off-host backup and recent restore test.
2. Read changelog for migrations/breaking changes.
3. Pull a named tag/image.
4. Build/pull both web and API artifacts.
5. Stop the API immediately before activation.
6. Activate new release and restart from the stable path.
7. Check health, sign-in, tenant access and one safe write.
8. Keep previous image/release until verification.
9. Never roll back the live SQLite file by copying over a running server.

### Release-directory deployments

When a platform builds versioned directories and flips a `current` symlink:

- build while old process continues serving;
- stop old process before symlink activation and release cleanup;
- never purge a directory still used as a process working directory;
- restart service from stable path;
- keep state outside release tree;
- verify health after the handoff.

## Incident containment

For suspected account/session compromise:

1. restrict public access at proxy;
2. preserve DB, audit and relevant proxy logs without modifying originals;
3. rotate provider credentials and auth secret (invalidates sessions);
4. review memberships, invitations and audit events;
5. patch/upgrade or restore only if integrity requires;
6. re-enable cautiously;
7. follow notification/disclosure obligations.

For disk full/snapshot failure, stop write traffic before cleanup. Never delete the only known-good
snapshot.

## Privacy posture

Document separately:

- domain and auth data stored;
- free-text fields;
- audit contents;
- browser preferences and offline snapshots;
- provider network behaviour;
- retention and erasure;
- backups/audit as separate retained copies;
- operator/controller responsibilities;
- hosted-service subprocessors/terms as a separate future requirement.

Field-level code-name projection is not encryption. Owners, DB operators and backups still hold real
values.

## Security maintenance

- Weekly: health, disk, backup freshness, advisories.
- Monthly: OS/container/dependency updates; staging login/restore.
- Each release: changelog, backup, deploy, smoke, rollback retention.
- Public security policy with private reporting.
- Support latest release and current main unless a longer policy is funded.
- Production dependency audit in the remote/manual gate.
- CodeQL and scorecard when repository/public service support makes them meaningful.

## Self-hosting acceptance checklist

- Fresh Compose install reaches health through web proxy.
- Fresh production instance starts empty, not with demo data.
- Auth-off production refuses by default.
- Setup secrets are not in image/repository.
- API cannot be reached around proxy.
- Persistent volume survives rebuild.
- Online snapshot appears and off-host copy is scheduled.
- Restore drill succeeds.
- Security headers and body limits pass smoke tests.
- Upgrade/rollback uses stable paths without replacing state.
- Logs contain no invite/reset raw tokens or domain field values.
- Operator docs state exact routine and incident actions.
