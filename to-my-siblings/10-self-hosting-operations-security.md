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
                                  ↓ optional online snapshots
                       persistent snapshot volume
                                  ↓ optional scheduled encrypted copy
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
- malformed OIDC endpoints/bootstrap list;
- missing, invalid or zero production rate limit;
- production audit explicitly disabled;
- temporary bootstrap-owner switch or operator-pinned bootstrap password.

Warn, rather than refuse, when context may make it legitimate:

- HSTS flag off because TLS may terminate at proxy;
- deliberately open signup;
- password or SSO mode without required MFA assurance;
- breached-password checking explicitly disabled for an isolated/offline installation;
- audit stdout, encrypted-storage attestation or separate security-log forwarding absent;
- internal TLS absent on a trusted same-host loopback proxy hop.

Every refusal should state the exact corrective variable/action.

### Community baseline versus hardened deployment

Do not make the most infrastructure-heavy deployment the only production shape. An open-source
sibling must be able to run safely on one host without requiring a log SaaS, backup provider,
encrypted block volume or private certificate authority. Split controls by what the application can
actually guarantee:

| Area | Community baseline | Optional hardened profile | Startup behavior |
| --- | --- | --- | --- |
| Authentication | Auth on; valid secret/public URL; closed signup; safe first-owner setup | Required password MFA or tested IdP MFA assurance | Refuse invalid/off auth; warn when MFA assurance is absent |
| Password screening | Breached-password checking on by default | Keep it on for internet-facing deployments | Warn, rather than refuse, when an isolated/offline operator explicitly disables it |
| Sessions/admin | Fixed session lifetime, revocation and fresh administrative actions | Add phishing-resistant factors or risk-based checks when justified | Always enforced; never weakened because MFA is optional |
| Rate limiting | Positive production limit | Edge/global limits and alerting | Refuse missing, invalid or zero application limit |
| Audit | Restrictive local mutation audit remains on | Duplicate typed events to stdout and ship them to a separate collector | Refuse local audit off; warn when stdout/forwarding attestations are absent |
| Storage/backups | Persistent restrictive database/audit files; snapshots may be disabled | Encrypted volume, scheduled snapshots, off-host copy and restore monitoring | Warn when encryption is unattested; do not pretend an attestation implements encryption |
| Proxy/API hop | Public HTTPS plus an API bound only to same-host loopback | Verified private service TLS or the packaged Compose CA | Warn when both internal TLS paths are absent; refuse a partial, empty or unreadable identity |

This split is not permission to lower the public boundary. Internet-facing traffic still needs TLS,
the API must remain unreachable around the proxy, authorization stays server-side, and secrets,
rate limiting, local audit and bootstrap safety stay fail-closed.

Attestation variables are evidence labels. A value such as `STORAGE_ENCRYPTED=1` or
`SECURITY_LOG_FORWARDING=1` must never create the impression that the application encrypted a disk
or installed a collector. Set one only after the operator has implemented and verified the external
control.

### OWASP/ASVS reporting for the tiered posture

Assess the community default honestly and describe the hardened profile separately. For the
CapacityLens `0.20.0-alpha.3` pattern:

- required MFA being optional means a password-only default does not meet ASVS 5.0 V6.3.3 Level 2;
- allowing breached-password screening to be disabled makes V6.2.12 Partial in a product-wide
  configuration review, even when the default remains on and a hardened deployment can satisfy it;
- permitting HTTP only across a same-host loopback proxy hop makes V12.3.3 deployment-dependent and
  therefore Partial unless the assessed deployment enables verified internal TLS;
- external log protection/forwarding and storage-at-rest evidence remain Partial without real
  operator evidence; environment attestations alone are not Pass evidence;
- local audit, authentication, authorization, safe session handling and the remaining application
  controls keep their own status and must not be downgraded merely because infrastructure hardening
  is optional.

When a status changes, update the detailed requirement row first, then recalculate the Pass/Partial/
Gap/N/A totals and finally update the executive security report, threat model and residual-risk
table. Never change only the headline score.

### Safe migration recipe

When a sibling inherited the former all-or-nothing guard:

1. Inventory every production refusal and classify it as an application safety invariant or an
   operator/deployment hardening choice.
2. Convert only the latter to named startup warnings. Keep auth, configuration validity, positive
   rate limiting, local audit and safe bootstrap paths as refusals.
3. Leave feature-level parsers strict. In particular, omitting both internal TLS paths may select
   loopback HTTP, but configuring only one path or supplying unreadable material must still abort.
4. Default required MFA off in Compose while leaving breached-password screening on by default.
5. Allow snapshots to be unset/disabled; describe local and off-host recovery consequences without
   making an external backup account a software prerequisite.
6. Add tests for a minimal production environment, a fully hardened environment, every warning,
   every retained refusal, default non-MFA authentication and partial TLS configuration.
7. Update the environment register, standing decisions, auth/privacy/self-hosting/runbook docs,
   threat model, control inventories, complete ASVS ledger and dated security review together.
8. Run the normal gates and a real production-entrypoint smoke with all optional hardening omitted;
   assert named warnings, successful loopback health and preserved audit/database health.
9. Deploy and verify the served build identifier as well as public deep health so a healthy previous
   release is not mistaken for a successful activation.

The copy-ready agent instruction for applying this pattern is
[`templates/optional-hardening-migration.md`](templates/optional-hardening-migration.md).

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

Optional layers, chosen according to recovery needs:

1. periodic online snapshots on the application host;
2. retention pruning;
3. scheduled encrypted copy to a separate failure domain;
4. monitoring of job success and newest usable snapshot age;
5. regular restore drill.

Database, audit and snapshot files use `0600` and their application-created directories use `0700`.
These permissions do not replace full-volume encryption, off-host access controls or an external
security-log destination.

An on-host snapshot is a convenient restore point, not disaster recovery. CapacityLens can also run
without scheduled snapshots; document the accepted data-loss exposure when doing so.

Keep database, snapshots, environment and operational logs outside directories replaced by
deployments.

### Pre-migration rollback snapshots

Scheduled snapshots may be optional, but an existing database must receive a verified one-shot
rollback snapshot before any application, control or authentication schema migration. Use the
configured backup directory when present and otherwise the database directory. Verify
`quick_check`, source `user_version`, owner-only permissions and that the result is one standalone
database without required WAL/SHM sidecars. Never retention-prune it automatically before the new
release is accepted. If creation or verification fails, startup refuses before DDL.

The complete migration, ledger, fixture and failure-rehearsal pattern is in
[chapter 18](18-database-migrations-and-upgrades.md).

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

1. For schema-bearing releases, run the automated migration rehearsal against both a released
   fixture and an anonymised representative long-lived installation.
2. If backups are enabled, confirm a recent snapshot and restore test; an off-host copy is
   recommended for disaster recovery.
3. Read changelog for migrations/breaking changes.
4. Pull a named tag/image.
5. Build/pull both web and API artifacts.
6. Stop the API immediately before activation.
7. Activate new release and restart from the stable path. Startup creates the mandatory
   pre-migration rollback snapshot before DDL.
8. Check health, sign-in, tenant access and one safe write.
9. Keep the previous image and matching pre-migration snapshot until verification.
10. Rollback by stopping the API, restoring that snapshot without stale sidecars and running its
    matching old image. Never point the old image at the upgraded database or copy over a live file.

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
- If backups are enabled, an online snapshot appears and its restore drill succeeds.
- If disaster recovery is required, an off-host copy is scheduled and monitored.
- Schema-bearing releases pass fixture and anonymised-installation migration rehearsals.
- Existing databases receive a verified pre-migration rollback snapshot before DDL.
- Security headers and body limits pass smoke tests.
- Upgrade/rollback uses stable paths without replacing state.
- Logs contain no invite/reset raw tokens or domain field values.
- Operator docs state exact routine and incident actions.
