---
title: Configure the API and nginx
description: Add the production environment, supervised API process and same-origin nginx routes for a managed CapacityLens site.
---

# Configure the API and nginx

This page starts the CapacityLens API as the isolated site user and connects it to the public web
app through nginx. It also enables scheduled backups, structured logs and deep health checks.
Allow about twenty minutes, including verification.

## Prerequisites

- Complete [Create and build the managed site](/self-hosting/managed-vps/create-and-build-the-site).
- Know the exact temporary or final public origin.
- Choose a loopback port not used by another site. This guide uses `8788` as an example.
- Have a private place to store the one-time [Owner](/reference/glossary) setup token.

## 1. Generate the secrets

Run this command twice on a trusted machine or through the platform's command runner:

```bash
openssl rand -base64 48
```

Use the first value for `SMALLSASS_ACCOUNT_SECRET`. Use the second value for
`SMALLSASS_ACCOUNT_SETUP_TOKEN`.

Store the setup token in a password manager before saving the environment. It is needed only to
claim the first Owner account. Never commit either value or paste it into deployment logs, support
messages or public issue reports.

If you use a browser-based environment editor, save the token before copying any later
configuration or process identifier. Copying text from another editor replaces the clipboard. If
that happens, reveal the saved environment privately and copy only the setup-token value again.

## 2. Set the production environment

Open the platform's environment editor. Replace every placeholder below:

```dotenv
NODE_ENV=production
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

SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE=self-hosted-password
SMALLSASS_ACCOUNT_MODE=password
SMALLSASS_ACCOUNT_SECRET=<session-signing-secret>
SMALLSASS_ACCOUNT_PUBLIC_URL=https://your-current-domain.example
SMALLSASS_ACCOUNT_SETUP_TOKEN=<one-time-owner-token>
SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK=on

VITE_CAPACITYLENS_API=
```

Confirm the platform stores one environment file outside the versioned release directories and
links or exposes it to every release as `.env`. A new release must not silently receive a fresh,
empty environment.

Leave these settings unset for this single-company, non-demo installation:

```text
VITE_CAPACITYLENS_DEMO
CAPACITYLENS_SEED_DEMO
CAPACITYLENS_MULTI_ACCOUNT
CAPACITYLENS_BOOTSTRAP_TOKEN
SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP
SMALLSASS_ACCOUNT_REQUIRE_MFA
```

Unset is different from `0` for some environment parsers. Remove the lines unless the
[Configuration](/self-hosting/configuration) page specifically says that an empty value has meaning.

If the platform already emits an HSTS header, leave `CAPACITYLENS_HTTPS` unset to avoid duplicate
headers. The public origin must still use HTTPS.

`CAPACITYLENS_HOST=127.0.0.1` does more than hide the API from the internet. A loopback listener
automatically trusts the `X-Forwarded-For` and `X-Forwarded-Proto` headers that nginx sets on the
next page, so rate limiting and audit records show the real visitor address rather than the proxy's.
Keep the API on loopback. If you ever bind it to another address, you must also set
`CAPACITYLENS_TRUST_PROXY_HEADERS=1`, and only when the API accepts connections from your proxy
alone — see [Configuration](/self-hosting/configuration).

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
/bin/bash -lc 'set -a; source .env; set +a; exec node server/dist/index.mjs'
```

The shell exports every value read from `.env`, then `exec` replaces the shell with Node so the
process supervisor sends shutdown signals directly to the API. CapacityLens needs more than ten
seconds before a forced kill so in-flight requests and backup work can drain.

::: warning `.env` is read as shell, so quote awkward values
`source` runs the file as a shell script. A value containing a space, `#`, `$`, backtick, quote or
backslash will be cut short or mangled, and the API will start with the wrong secret rather than
fail loudly. The `openssl rand -base64 48` values above are safe unquoted. Anything you paste from
elsewhere — a company-login client secret, for example — must be wrapped in single quotes:

```dotenv
SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET='the value exactly as issued'
```

A single quote inside the value itself cannot be escaped between single quotes. If one appears, ask
the provider to reissue the secret rather than inventing an escape.
:::

Do not use `pnpm start` for the production process. The prebuilt `index.mjs` has no runtime
dependency on pnpm or the development packages.

In Laravel Forge, save the background process and record the generated Supervisor group name. It
looks like `daemon-1234567`. You will need that neutral platform identifier in the deployment
script; do not guess it.

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

It may already report `"status":"ok"` if the first backup has finished — a snapshot takes seconds,
so re-check after about a minute. Treat `degraded` as a failure, and investigate `pending` that
lasts longer than one configured backup interval (60 minutes with the configuration on this page).
[Monitoring and health checks](/self-hosting/monitoring#what-each-field-means-and-when-to-alert)
defines the alert threshold.

Stop here if the command fails. Read the background-process log and correct the first startup
error before editing nginx.

Some managed command runners display their own temporary output-file error after the command has
finished. That message does not prove the API failed. Check the process log and run the same health
request from another trusted shell. Continue only when you can read a successful JSON response.

## 5. Add the nginx routes

Open the platform's nginx configuration for this site. Preserve the platform's generated includes,
TLS directives, logging, PHP exclusions and management comments.

Add an API location that points to this installation's loopback port:

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

Replace a generated `try_files $uri $uri/ =404;` rule rather than adding a second competing
`location /` block.

Laravel Forge marks generated sections with comments such as `# FORGE CONFIG`. Keep those sections
intact so Forge can continue managing certificates and other site settings.

Test and reload nginx using the platform's save action. If the platform does not test first, run:

```bash
sudo nginx -t
```

Only reload nginx after that command succeeds.

## 6. Add the public health check

Set the platform's post-deployment or uptime health URL to:

```text
https://your-current-domain.example/api/health
```

The check must use the public HTTPS route rather than the loopback port. That proves DNS, TLS,
nginx, the API process and SQLite readiness together.

## Verify the result

Run:

```bash
curl -fsS https://your-current-domain.example/api/health
```

Then open the public origin and confirm:

- the sign-in or first-owner screen loads;
- refreshing a nested browser route returns the app rather than nginx `404`;
- the background process remains **Running**;
- the database and first scheduled backup appear outside the release tree; and
- the public health check is operational.

Do not claim the Owner until the public origin is HTTPS and matches
`SMALLSASS_ACCOUNT_PUBLIC_URL` exactly.

## What's next

Continue to [Deploy and upgrade safely](/self-hosting/managed-vps/deploy-and-upgrade-safely) before making this site's
deployment script permanent.
