---
title: Monitoring
description: Monitor liveness, database readiness, backup results and privacy-safe application logs.
---

# Monitoring

Probe the application through the same trusted proxy that serves users. Use the two dedicated
health endpoints for process supervision:

| Endpoint | Meaning |
| --- | --- |
| `GET /health/live` | The process can answer HTTP. It does not prove the database or backups are ready. |
| `GET /health/ready` | Checks the database and accepted migration history; returns a failing status when those checks fail. |

Do not use `/api/health` as a readiness probe; it is a lightweight API response. Keep health checks
free of credentials and do not expose diagnostic internals publicly.

## Database and backups

Investigate readiness failures before restarting repeatedly. Check that the database file exists,
its parent directory is writable by the service user, and the released migration history is
accepted by the current release.

Check backup success independently: inspect the service logs for failed snapshots or retention
errors, free disk space and directory permissions, then confirm a recent completed snapshot in
`CAPACITYLENS_BACKUP_DIR`. Backups run at startup and every 24 hours while the service runs.
Readiness has no backup health latch; a healthy response does not prove recovery is available.

Run `node ace.js db:backup` from `backend/` for an operator-requested snapshot. See
[Backups and restore](/self-hosting/backups-and-restore).

## Logs and operational limits

Use the service manager's journal or log destination. For systemd:

```bash
journalctl -u capacitylens --since "30 min ago"
```

Routine request-completion logs are off unless `CAPACITYLENS_LOG=1`. Unexpected failures remain
visible, with private messages and request/response payloads redacted. Do not enable verbose
request-body logging in a proxy or collect invitation, sign-in or password-reset links.

Authentication and request-work safeguards are process-wide, not per-company reservations.
Authentication is identity-global before company selection. Use edge/global quotas or separate
CapacityLens instances when installations require resource isolation; one shared instance does not
provide per-company resource reservations.

For incidents, use [Incident response](/self-hosting/incidents). For public proxy requirements, see
[TLS and networking](/self-hosting/tls-and-networking).
