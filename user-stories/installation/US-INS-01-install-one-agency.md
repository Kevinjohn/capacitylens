# US-INS-01 — Install and operate one agency instance

As a hosting operator, I want to install and maintain the release on a host so that one agency can use a secure persisted service.

**Status:** Operator

**Access:** Hosting operator; company Owner completes browser company setup

**Entry:** Release archive, environment configuration, upgrade and health commands

**Documentation:** [Install](../../docs-src/self-hosting/install.md)

**Source:** [commands](../../apps/backend/commands); [start](../../apps/backend/start); [packaging](../../packaging)

## Acceptance criteria

- A native release archive runs with configured secrets, database and HTTPS origin; upgrades back up before migration, readiness checks database health, and initial Owner admission uses the bootstrap invitation. No Docker task is included in this story.
