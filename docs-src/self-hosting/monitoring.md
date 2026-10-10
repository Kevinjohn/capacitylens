---
title: Monitoring and health checks
description: The health endpoint to poll, what its fields mean, where the logs live, and what to check on a regular schedule.
---

# Monitoring and health checks

Poll `GET /api/health` through the same public proxy your users reach, and alert on the signals
in the table below. Never expose the API container directly. The endpoint needs no sign-in and
is exempt from rate limiting, so ordinary traffic cannot starve your uptime probe.

## The health endpoint

For Docker Compose:

```bash
docker compose ps
docker compose logs --since=30m api
curl -fsS https://capacity.example.com/api/health
```

For a native systemd install, check the service and recent logs:

```bash
sudo systemctl status capacitylens --no-pager
```

```bash
sudo journalctl -u capacitylens --since "30 min ago" --no-pager
```

On a managed VPS, use the provider's process status and application log view for the site; see
[Finish and operate the installation](/self-hosting/managed-vps/finish-and-operate-the-installation).

With `CAPACITYLENS_HEALTH_DEEP=1` (Docker Compose sets this by default), the response also runs
a constant SQLite readiness query and reports:

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

Without deep health, the response is a plain `{"ok":true}`. Startup separately runs a full
foreign-key integrity check before the API accepts any traffic.

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

The one-shot `internal-tls` service should have exited zero. A zero exit from the `openssl`
command means the certificate is valid for at least 30 days. A non-zero exit means it has expired
or will within 30 days: run `./scripts/renew-internal-tls.sh`, as described in
[TLS and networking](/self-hosting/tls-and-networking).

## Logs

- **Application/process logs**: `docker compose logs api` (and `web`). Set
  `CAPACITYLENS_LOG=1` for structured per-request JSON logs.
- **Native systemd**: `sudo journalctl -u capacitylens`.
- **Managed VPS**: the provider's application log view for the site.
- **Security events**: typed `capacitylens.security` JSON events on stdout for sign-in
  outcomes, CSRF and authorization rejections, rate limiting, session revocation and server
  errors. Alert on bursts and suspicious cross-account patterns. The absence of an application
  event does not prove proxy or identity-provider traffic was benign.
- **Audit log**: every product-data change, written to JSONL next to the database, and also to
  stdout as one-line `{"type":"capacitylens.audit",...}` envelopes when
  `CAPACITYLENS_AUDIT_STDOUT=1` (Compose sets this by default). Forward both streams to a
  separate collector for real retention; local files remain available without forwarding.
  CapacityLens will not start in production with the audit log turned off.

Logs may contain identifiers; keep them according to your own retention policy.

Alert on repeated `password_security_queue_saturated` security events. Password hashing and
breached-password checks use bounded queues, and this event fires when work is shed or
withdrawn. It signals sustained CPU or dependency pressure, not bad credentials.

## Service limits worth knowing

These limits are fixed, not configurable:

- The API accepts at most 512 simultaneous sockets per process; the proxy returns an
  upstream error for the client to retry rather than queuing without bound.
- Each request has a 30-second server timeout.
- Exactly one API process should run against a given SQLite file.
- On shutdown, the API stops accepting new work and gives in-flight requests and
  background snapshots ten seconds to drain before force-exiting. Let your process supervisor
  wait more than ten seconds before sending `SIGKILL`.
- An uncaught exception emits a `process_failure` security event and exits the process
  non-zero; Compose restarts it automatically. Alert on every such event and on restart
  loops. A restart is not remediation; investigate the underlying defect.
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
  releases, keep the migration rehearsal result with your release evidence; see
  [Upgrades](/self-hosting/upgrades).
- **After any sign-in or cryptography change**: exercise enrolment, recovery-code storage,
  session revocation, password-reset invalidation and the breached-password-service outage path
  in a test environment. For Google or Microsoft company sign-in, verify the registered
  callback, admission, linking and returning sign-in with that installation's provider
  configuration.

When an alert fires, see [When something goes wrong](/self-hosting/incidents).
