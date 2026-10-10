---
title: Monitoring and health checks
description: The health endpoint to poll, what its fields mean, where the logs live, and what to check on a regular schedule.
---

# Monitoring and health checks

The minimum:

1. Poll `GET /api/health` through the public proxy your users reach. It needs no sign-in and is
   exempt from rate limiting. Never expose the API container directly.
2. Alert on the [signals below](#what-each-field-means-and-when-to-alert), on every
   `process_failure` security event and on restart loops.
3. Forward the audit and security logs to a separate collector.
4. Run the [routine maintenance](#routine-maintenance) checks.

## The health endpoint

For Docker Compose:

```bash
docker compose ps
docker compose logs --since=30m api
curl -fsS https://capacity.example.com/api/health
```

For a native systemd install:

```bash
sudo systemctl status capacitylens --no-pager
```

```bash
sudo journalctl -u capacitylens --since "30 min ago" --no-pager
```

On a managed VPS, use the provider's process status and application log view (see
[Keep it running](/self-hosting/managed-vps/#keep-it-running)).

Deep health (`CAPACITYLENS_HEALTH_DEEP=1`, on by default in production) also runs a SQLite
readiness query and reports:

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

Without it, the response is a plain `{"ok":true}`. Startup also runs a full foreign-key integrity
check before the API accepts traffic.

## What each field means, and when to alert

| Signal               | Alert when                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit`              | `degraded`: the audit sink has failed and events are queued. `recovering` with a nonzero `auditPending` is expected briefly after a restart; alert if it doesn't drain.                                                                                 |
| `backup.status`      | `degraded` after any failed snapshot attempt, or `pending` for longer than one configured backup interval. Alert on `unavailable` when scheduled backups are expected; check whether backups were deliberately disabled before treating it as a failure. |
| `internalTls.status` | `expiring` or `expired`. `expiring` starts at the same 30-day boundary the renewal script uses; renew before it reaches zero. See [TLS and networking](/self-hosting/tls-and-networking).                                                              |
| HTTP `5xx`           | Any occurrence. Investigate immediately.                                                                                                                                                                                                                |
| HTTP `401`/`403`     | Repeated occurrences. Review them as access events.                                                                                                                                                                                                     |
| HTTP `409`           | A sustained spike. Occasional write conflicts are expected.                                                                                                                                                                                             |
| HTTP `429`           | A sustained spike of rate limiting.                                                                                                                                                                                                                     |

To check the internal certificate on Docker Compose:

```bash
docker compose ps --all
docker compose run --rm --entrypoint openssl internal-tls x509 \
  -in /tls/api.crt -noout -issuer -subject -checkend 2592000
```

`internal-tls` should have exited zero. A zero exit from `openssl` means the certificate is valid
for at least 30 days; otherwise run `./scripts/renew-internal-tls.sh` (see
[TLS and networking](/self-hosting/tls-and-networking)).

## Logs

Process logs: `docker compose logs api` (and `web`), `sudo journalctl -u capacitylens`, or the
managed host's application log view. `CAPACITYLENS_LOG=1` (on by default in production) makes
them structured per-request JSON. Logs may contain identifiers; keep them according to your own
retention policy.

- **Security events**: typed `capacitylens.security` JSON events on stdout for sign-in
  outcomes, CSRF and authorization rejections, rate limiting, session revocation and server
  errors. Alert on bursts and suspicious cross-account patterns, and on repeated
  `password_security_queue_saturated` events, which mean password work was shed under sustained
  CPU or dependency pressure, not bad credentials. A missing event does not prove proxy or
  identity-provider traffic was benign.
- **Audit log**: every product-data change, as JSONL next to the database, and also on stdout as
  one-line `{"type":"capacitylens.audit",...}` envelopes when `CAPACITYLENS_AUDIT_STDOUT=1` (on by
  default in production). Forward both streams to a separate collector for real retention.
  CapacityLens will not start in production with the audit log turned off.

## Fixed service limits

- The API accepts at most 512 simultaneous sockets per process; the proxy returns an
  upstream error for the client to retry rather than queuing without bound.
- Each request has a 30-second server timeout.
- Exactly one API process should run against a given SQLite file.
- On shutdown, in-flight requests and background snapshots get ten seconds to drain before
  force-exit. Let your process supervisor wait more than ten seconds before sending `SIGKILL`.
- An uncaught exception emits a `process_failure` security event and exits non-zero; Compose
  restarts it automatically. A restart is not remediation; investigate the underlying defect.
- Breached-password (HIBP) range lookups run at most eight at a time with thirty-two queued, each
  with a five-second timeout. Password hashing that overflows its queue aborts without producing
  a wrong-password verdict.
  These scrypt/HIBP queues are process-wide availability safeguards, not per-company reservations.
  Password authentication is identity-global and occurs before company selection, so every
  company on a multi-company instance shares them. Use edge/global quotas or separate
  CapacityLens instances, each with its own database, when adversarial isolation is
  required; do not weaken the memory bounds.

## Routine maintenance

- **Weekly**: check health, disk space, backup freshness and security advisories.
- **Monthly**: apply OS, container and dependency updates; test sign-in and a restore in
  staging.
- **Every release**: follow [Upgrades](/self-hosting/upgrades): review the security workflow,
  SBOM and image scan results; read the changelog; back up; deploy; smoke test; keep a rollback
  image and, for schema-bearing releases, the migration rehearsal result.
- **After any sign-in or cryptography change**, in a test environment: exercise enrolment,
  recovery-code storage, session revocation, password-reset invalidation and the
  breached-password-service outage path. For Google or Microsoft, verify the registered callback,
  admission, linking and returning sign-in.

When an alert fires, see [When something goes wrong](/self-hosting/incidents).
