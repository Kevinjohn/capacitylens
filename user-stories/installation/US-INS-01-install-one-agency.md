# US-INS-01 — Install and operate one agency instance

As a hosting operator, I want to install and maintain the release on a host so that one agency can use a secure persisted service.

**Status:** Operator

**Access:** Hosting operator; company Owner completes browser company setup

**Entry:** Release archive install command, or manual environment configuration, upgrade and health commands

**Documentation:** [Install](../../docs-src/self-hosting/install.md); [Install without Docker](../../docs-src/self-hosting/install-without-docker.md); [Upgrades](../../docs-src/self-hosting/upgrades.md)

**Source:** [commands](../../apps/backend/commands); [start](../../apps/backend/start); [packaging](../../packaging)

## Acceptance criteria

- A native release archive runs with configured secrets, database and HTTPS origin; `app:upgrade` backs up an existing database before migrating, `/health/ready` checks database readiness, and initial Owner admission uses the bootstrap invitation. No Docker task is included in this story.
- From the unpacked archive, `sudo sh install.sh DOMAIN OWNER_EMAIL` writes the root-only environment file with generated secrets, runs `app:upgrade`, installs and starts the systemd unit, writes a same-machine Caddy site when Caddy is installed (otherwise prints the address to proxy to) and prints the setup link. Scheduled backups run in the service.
- Running the command again keeps the environment file and its secrets. Run without arguments from a newer release, it stops the service, switches `current`, runs `app:upgrade` and starts the service only after the upgrade succeeds.

## User flow

```mermaid
flowchart TD
  prepare["Hosting operator unpacks the release and runs install.sh, or prepares the environment by hand"] --> upgrade["Run app:upgrade"]
  upgrade --> backup["Existing database is backed up before migration"]
  backup --> migrate["Migrations run and schema is checked"]
  migrate --> service["Start service and check /health/ready"]
  service --> bootstrap["Issue Account Kit bootstrap invitation"]
  bootstrap --> setup["Admitted person signs in and enters company details"]
  setup -->|success| company["Company opens for planning"]
  setup -->|failure| error["Visible setup error; retry remains possible"]
```

## Code flow

```mermaid
flowchart TD
  start["install.sh checks native prerequisites and first-install or no-argument upgrade inputs"] -->|Refusal| preflight["Exit before stopping any installed unit"]
  start -->|Accepted| env["Create first environment or reuse existing environment and secret"]
  env --> stop["Stop existing unit and point current at the release"]
  stop --> upgrade["AppUpgrade.run delegates backup and migrations to db:upgrade --no-schema-generate"]
  upgrade -->|Succeeded| integrity["assertSchemaIntegrity"]
  upgrade -->|Failed| stopped["Exit before starting the unit"]
  integrity -->|Failed| stopped
  integrity -->|Succeeded| service["Install the systemd unit and enable/start it"]
  service -->|No-argument upgrade| exitUpgrade["Installer exits"]
  service -->|First install with Caddy| caddy["Write and validate site configuration; reload Caddy"]
  service -->|First install without Caddy| proxy["Print manual HTTPS proxy instructions"]
  caddy --> bootstrap["Ace runs account-kit:admission:bootstrap to issue the first invitation"]
  proxy --> bootstrap
  service --> probe["Operator checks /health/ready independently"]
  service --> backup["BackupProvider runs a startup and daily backup when configured"]
  bootstrap --> boundary["First identity uses the first-company setup journey"]
```

See [Set up and open the installation company](../navigation/US-NAV-14-company-picker-setup.md#code-flow) for the browser continuation.

**Code references:** [install.sh](../../packaging/release/install.sh#L32) · [install.sh](../../packaging/release/install.sh#L49) · [Installer stop and restart ordering](../../packaging/release/install.sh#L65) · [Bootstrap command](../../packaging/release/install.sh#L88) · [Ace command registration](../../apps/backend/adonisrc.ts#L27) · [app_upgrade.ts](../../apps/backend/commands/app_upgrade.ts#L13) · [routes.ts](../../apps/backend/start/routes.ts#L57) · [backup_provider.ts](../../apps/backend/providers/backup_provider.ts#L45) · [install-without-docker.md](../../docs-src/self-hosting/install-without-docker.md#L143)
