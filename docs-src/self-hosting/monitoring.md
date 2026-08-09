---
title: Monitoring and health checks
description: The health endpoint to poll, what its fields mean, where the logs live, and what to check on a regular schedule.
---

# Monitoring and health checks

CapacityLens exposes one health endpoint and two log streams. This page covers what to
poll, what the fields mean, where to look when something's off, and a routine maintenance
schedule.

## The health endpoint

`GET /api/health` needs no sign-in and is exempt from rate limiting, so ordinary API
traffic can never starve your uptime probe. Poll it through the same public proxy your
users reach — never expose the API container directly.

```bash
docker compose ps
docker compose logs --since=30m api
curl -fsS https://capacity.example.com/api/health
```

With `CAPACITYLENS_HEALTH_DEEP=1` (Docker Compose sets this by default), the response
also runs a constant SQLite readiness query and reports:

```json
{
  "ok": true,
  "db": true,
  "audit": "ok",
  "auditPending": 0,
  "backup": { "status": "ok", "lastSuccessAt": "2026-07-27T12:00:00.000Z" },
  "internalTls": { "status": "ok", "expiresAt": "...", "daysRemaining": 90, "fingerprintSha256": "..." }
}
```

Without deep health, the response is a plain `{"ok":true}`. Startup separately performs a
full foreign-key integrity check before the API accepts any traffic at all.

## What each field means, and when to alert

| Signal               | Alert when                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `audit`              | `degraded` — the audit sink has failed and events are queued. `recovering` with a nonzero `auditPending` is expected briefly after a restart; alert if it doesn't drain.                   |
| `backup.status`      | `degraded` after any failed snapshot attempt, or `pending` for longer than one configured backup interval.                                                                                 |
| `internalTls.status` | `expiring` or `expired`. `expiring` starts at the same 30-day boundary the renewal script uses — renew before it reaches zero. See [TLS and networking](/self-hosting/tls-and-networking). |
| HTTP `5xx`           | Any occurrence — investigate immediately.                                                                                                                                                  |
| HTTP `401`/`403`     | Repeated occurrences — treat as access events worth reviewing.                                                                                                                             |
| HTTP `409`           | Write conflicts — expected occasionally, alert on a sustained spike.                                                                                                                       |
| HTTP `429`           | Rate limiting — alert on a sustained spike.                                                                                                                                                |

Certificate health specifically:

```bash
docker compose ps --all
docker compose run --rm --entrypoint openssl internal-tls x509 \
  -in /tls/api.crt -noout -issuer -subject -checkend 2592000
```

Confirm the one-shot `internal-tls` service exited zero and the leaf remains valid for
the next 30 days. A zero exit from the `openssl x509 ... -checkend 2592000` command above
means the certificate is valid for at least those 30 days — nothing to do. A non-zero
exit means it's already expired or will within 30 days; run
`./scripts/renew-internal-tls.sh` to renew it — see
[TLS and networking](/self-hosting/tls-and-networking).

## Logs

- **Application/process logs**: `docker compose logs api` (and `web`). Set
  `CAPACITYLENS_LOG=1` for structured per-request JSON logs.
- **Security events**: typed `capacitylens.security` JSON events for sign-in outcomes,
  CSRF and authorization rejections, multi-factor gates, rate limiting, session
  revocation and server errors — on stdout alongside the process logs. Alert on bursts
  and suspicious cross-account patterns; the absence of an application event is not proof
  that proxy or identity-provider traffic was benign.
- **Audit log**: every product-data change, written to JSONL next to the database (or to
  stdout as well, as one-line `{"type":"capacitylens.audit",...}` envelopes, when
  `CAPACITYLENS_AUDIT_STDOUT=1` — Compose sets this by default). Forward both streams to
  a separate collector for real retention; local files remain available even without
  forwarding, and CapacityLens will not start in production with the audit log itself
  turned off.
- Logs may contain identifiers — follow your own retention policy for how long you keep
  them.

Watch for a `password_security_queue_saturated` security event: password hashing and
breached-password checks use bounded queues, and this event fires when work is shed or
withdrawn. It signals sustained CPU or dependency pressure, not bad credentials — alert
on repeated occurrences.

## Service limits worth knowing

These are fixed, not configurable, and explain some things you might otherwise mistake
for a bug:

- The API accepts at most 512 simultaneous sockets per process; the proxy returns an
  upstream error for the client to retry rather than queuing unboundedly.
- Each request has a 30-second server timeout.
- Exactly one API process should run against a given SQLite file.
- On shutdown, the API stops accepting new work and gives in-flight requests and
  background snapshots ten seconds to drain before force-exiting; your process supervisor
  should allow more than ten seconds before sending `SIGKILL`.
- An uncaught exception emits a `process_failure` security event and exits the process
  non-zero; Compose restarts it automatically. Alert on every such event and on restart
  loops — a restart is not remediation, investigate the underlying defect.
- Password sign-in work is bounded: breached-password (HIBP) range lookups run at most
  eight at a time with thirty-two queued, each with a five-second timeout, and password
  hashing that overflows its queue aborts without producing a wrong-password verdict.
  These scrypt/HIBP queues are process-wide availability safeguards, not per-company reservations.
  Password authentication is identity-global and occurs before company selection, so every
  company on a multi-company instance shares them. Use edge/global quotas or separate
  CapacityLens instances, each with its own database, when adversarial isolation is
  required; do not weaken the memory bounds.

## Routine maintenance

- **Weekly**: check health, disk space, backup freshness and security advisories.
- **Monthly**: apply OS, container and dependency updates; test sign-in and a restore in
  staging.
- **Every release**: review the security workflow, SBOM and image scan results; read the
  changelog; back up; deploy; smoke test; keep a rollback image. For schema-bearing
  releases, keep the migration rehearsal result with your release evidence — see
  [Upgrades](/self-hosting/upgrades).
- **After any sign-in or cryptography change**: exercise enrolment,
  recovery-code storage, session revocation, password-reset invalidation and the
  breached-password-service outage path in staging. For strict OIDC, also run
  issuer/audience/signature/key-rotation tests and `pnpm run e2e:oidc` against the pinned
  reference provider.

## What's next

- [When something goes wrong](/self-hosting/incidents) for what to do about the alerts
  above.
- [Backups and restore](/self-hosting/backups-and-restore) if `backup.status` needs
  attention.
