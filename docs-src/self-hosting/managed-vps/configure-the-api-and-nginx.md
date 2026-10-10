---
title: Configure the API and nginx
description: Add the production environment, supervised API process and same-origin nginx routes for a managed CapacityLens site.
---

# Configure the API and nginx

Long-form route: building from a source checkout. To install from the release archive with
nothing to build, follow the [five steps](/self-hosting/managed-vps/) instead.

Start the API as the isolated site user, connect it to the web app through nginx, and turn on
scheduled backups, structured logs and deep health checks. Allow about twenty minutes, including
verification.

## Prerequisites

- Complete [Create and build the managed site](/self-hosting/managed-vps/create-and-build-the-site).
- Know the exact temporary or final public origin.
- Choose a loopback port not used by another site. This guide uses `8788` as an example.
- Have a private place to store the one-time [Owner](/reference/glossary) setup token.

## 1. Generate the secrets

Run `init` through the platform's command runner from the site's folder, with your origin:

```bash
node current/production/server/dist/index.mjs init --public-url https://your-current-domain.example --db /home/<site-user>/data/capacitylens.db
```

Copy its `CAPACITYLENS_SECRET` and `CAPACITYLENS_SETUP_TOKEN` values into the environment in the
next step, and leave out the other lines: this route sets them differently.

Store the setup token in a password manager before saving the environment; it is needed only to
claim the first Owner account. Never commit either value or paste it into deployment logs, support
messages or public issue reports. In a browser-based editor, save the token before copying
anything else, or reveal the saved environment privately and copy it again.

## 2. Set the production environment

In the platform's environment editor, replace every placeholder below:

```dotenv
PORT=8788
CAPACITYLENS_HOST=127.0.0.1

CAPACITYLENS_DB=/home/<site-user>/data/capacitylens.db
CAPACITYLENS_BACKUP_DIR=/home/<site-user>/backups
CAPACITYLENS_BACKUP_INTERVAL_MIN=60
CAPACITYLENS_BACKUP_KEEP=48
CAPACITYLENS_AUDIT_FILE=/home/<site-user>/data/capacitylens-audit.jsonl
CAPACITYLENS_AUDIT_MAX_MB=64

CAPACITYLENS_HTTPS=1
CAPACITYLENS_LOG=1
CAPACITYLENS_HEALTH_DEEP=1
CAPACITYLENS_RATE_LIMIT=300

CAPACITYLENS_DEPLOYMENT_PROFILE=self-hosted-password
CAPACITYLENS_MODE=password-only
CAPACITYLENS_SECRET=<session-signing-secret>
CAPACITYLENS_PUBLIC_URL=https://your-current-domain.example
CAPACITYLENS_SETUP_TOKEN=<one-time-owner-token>
CAPACITYLENS_PASSWORD_BREACH_CHECK=on

VITE_CAPACITYLENS_API=
```

Confirm the platform stores one environment file outside the release directories and exposes it
to every release as `.env`, so a new release never receives a fresh, empty environment. Keep the
database, audit log and backup directory on storage encrypted at rest; CapacityLens does not
encrypt the host or filesystem.

Leave these unset for a single-company, non-demo installation:

```text
VITE_CAPACITYLENS_DEMO
CAPACITYLENS_SEED_DEMO
CAPACITYLENS_MULTI_ACCOUNT
CAPACITYLENS_BOOTSTRAP_TOKEN
CAPACITYLENS_ALLOW_OPEN_SIGNUP
```

Some parsers treat unset differently from `0`, so remove the lines unless
[Configuration](/self-hosting/configuration) says an empty value has meaning.

If the platform already emits an HSTS header, set `CAPACITYLENS_HTTPS=0` to avoid duplicates;
otherwise leave it unset and an `https` public URL makes the API emit host-only HSTS. The public
origin must use HTTPS either way.

Keep `CAPACITYLENS_HOST=127.0.0.1`. A loopback listener trusts the `X-Forwarded-For` and
`X-Forwarded-Proto` headers nginx sets, so rate limiting and audit records show the real visitor
address. If you ever bind another address, also set `CAPACITYLENS_TRUST_PROXY_HEADERS=1`, and only
when the API accepts connections from your proxy alone; see
[Configuration](/self-hosting/configuration).

## 3. Create the background process

Create one supervised background process with these properties:

```text
Name: CapacityLens API
User: <site-user>
Processes: 1
Working directory: /home/<site-user>/<site-domain>/current
Restart when it exits: yes
Stop timeout: more than 10 seconds
```

Use this command:

```bash
/bin/bash -lc 'set -a; source .env; set +a; exec env NODE_ENV=production node production/server/dist/index.mjs'
```

The shell exports every value in `.env`, then `exec env` starts the API with production mode set
on its process. Keeping `NODE_ENV` out of `.env` stops Vite reading it during the browser build.
`exec` replaces the shell so the supervisor's shutdown signals reach the API, which needs more than
ten seconds to drain in-flight requests and backup work.

::: warning `.env` is read as shell, so quote awkward values
`source` runs the file as a shell script. A value containing a space, `#`, `$`, backtick, quote or
backslash is cut short or mangled, and the API starts with the wrong secret instead of failing.
The secrets `init` generates are safe unquoted. Wrap anything pasted from elsewhere, such as a
company-login client secret, in single quotes:

```dotenv
CAPACITYLENS_GOOGLE_CLIENT_SECRET='the value exactly as issued'
```

A single quote inside the value cannot be escaped this way; ask the provider to reissue the
secret.
:::

Don't use `pnpm start`: the prebuilt `index.mjs` needs neither pnpm nor the development packages.

In Forge, save the process and record the generated Supervisor group name, such as
`daemon-1234567`. The deployment script needs that exact value.

## 4. Verify the API on loopback

Wait for the process status to show **Running**, then run:

```bash
curl -fsS http://127.0.0.1:8788/api/health
```

With deep health enabled, an API that has just started can report the first backup as `pending`:

```json
{
  "ok": true,
  "db": true,
  "audit": "ok",
  "auditPending": 0,
  "backup": { "status": "pending", "lastSuccessAt": null }
}
```

Re-check after about a minute; a snapshot takes seconds, so it should then read `"status":"ok"`.
Treat `degraded` as a failure, and investigate `pending` that lasts longer than one backup
interval (60 minutes here).
[Monitoring and health checks](/self-hosting/monitoring#what-each-field-means-and-when-to-alert)
defines the alert threshold.

If the command fails, stop. Read the background-process log and fix the first startup error
before editing nginx. Some command runners show their own temporary output-file error after the
command finishes; that does not prove the API failed. Check the process log and repeat the
request from another trusted shell. Continue only with a successful JSON response.

## 5. Add the nginx routes

Open the site's nginx configuration. Keep the platform's generated includes, TLS directives,
logging, PHP exclusions and management comments (Forge marks them with comments such as
`# FORGE CONFIG`) so the platform can keep managing certificates and settings.

Add an API location pointing to this installation's loopback port:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8788;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Set the main location to fall back to the single-page app:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Replace a generated `try_files $uri $uri/ =404;` rule; don't add a second `location /` block.

Save through the platform, which tests and reloads nginx. If it does not test first, run this and
reload only after it succeeds:

```bash
sudo nginx -t
```

## 6. Add the public health check

Set the platform's post-deployment or uptime health URL to:

```text
https://your-current-domain.example/api/health
```

Use the public HTTPS route, not the loopback port, so the check proves DNS, TLS, nginx, the API
and SQLite together.

## Verify the result

Run:

```bash
curl -fsS https://your-current-domain.example/api/health
```

Open the public origin and confirm:

- the sign-in or first-owner screen loads;
- refreshing a nested browser route returns the app rather than nginx `404`;
- the background process remains **Running**;
- the database and first scheduled backup appear outside the release tree; and
- the public health check is operational.

Do not claim the Owner until the public origin is HTTPS and matches
`CAPACITYLENS_PUBLIC_URL` exactly.

Next: [Deploy and upgrade safely](/self-hosting/managed-vps/deploy-and-upgrade-safely), before making
the deployment script permanent.
