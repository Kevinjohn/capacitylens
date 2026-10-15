---
title: Require Google sign-in
description: Configure Google sign-in, connect existing accounts, and require Google for company access.
---

# Require Google sign-in

Run Google alongside passwords, or require everyone to use Google. This page is for the server
operator.

![Google-only sign-in screen without a password form](../screenshots/company_sign_in_only.png)

## Configure and check Google sign-in

1. Register Google by following [Set up Google sign-in](/company-login/set-up-company-login).
2. Set both values below while password and company sign-in should both remain available, and
   restart:

   ```dotenv
   CAPACITYLENS_MODE=password-and-sso
   CAPACITYLENS_DEPLOYMENT_PROFILE=self-hosted-mixed
   ```

3. Check **Sign in with Google** appears and complete one sign-in with an allowed account before
   asking teammates to connect.

## Connect existing accounts

Each person connects their existing account from **Account → Security**, as
[Connect an existing account](/company-login/#connect-an-existing-account) describes. Connecting
keeps their memberships, role and scheduled work.

If someone's local email is unverified, they can prove their current address through the existing
company-joining flow when password sign-in and email verification are available: open the company's
**Join company** link, sign in, and choose **Join company**. When prompted, choose **Email me a
verification link** and open it within 60 minutes in the same signed-in session. The link returns
them to the join page; they choose **Join company** again to verify the address and finish joining
when company policy allows it. They can then return to **Account → Security** and connect Google
when its verified address matches their local email. This proves the existing address; it does not
change or correct the address on the account.

<span id="require-a-company-provider"></span>

## Prepare a legacy server cutover

The preflight and repair commands in this section are provided by the legacy `capacitylens-server`
package. They are not available in the current Adonis app. Do not run them against a current Adonis
deployment.

Keep `CAPACITYLENS_DEPLOYMENT_PROFILE=self-hosted-mixed` while preparing. The check and repair
commands run from a maintenance checkout of the running release, as
[Run recovery commands](/self-hosting/incidents#run-recovery-commands-on-docker-or-a-managed-host)
describes. They read the profile, mode and provider settings from their own environment, so load
the instance's environment file into the shell first; in a POSIX shell,
`set -a; . /path/to/capacitylens.env; set +a` does this. On a Linux host the file is readable only
by root, so run this and the commands below as root, for example in `sudo -s`.

With Google configured on a legacy server, run the read-only all-company check against that
server's database:

```bash
pnpm --filter capacitylens-server cutover:preflight -- /path/to/capacitylens.db
```

To pass, every existing sign-in account needs a verified connection to any configured company
provider, every company needs active members and an active Owner, and open password signup must
be disabled.

Decide from the top-level `ready` result and `issues` list; each issue has a stable reason code and
an explanation. The `diagnostics` list gives per-provider repair details and may flag a missing
connection to one provider even when another satisfies the check; it adds no restrictions. The
same checks run when the server starts. Resolve blocking issues in mixed mode and rerun the check.
It does not switch modes itself.

If a finding needs identity or membership repair, the guarded `cutover:repair` command can:

- remove one exact provider link
- remove a credential-only or providerless identity with no active company memberships
- make an existing active member Owner of an ownerless company
- erase a company with no active members.

::: warning
Some repairs permanently remove identity or company data. Keep a backup, follow the command's
exact target checks, and do not use it to work around a finding you do not understand.
:::

The command requires `CAPACITYLENS_DEPLOYMENT_PROFILE=self-hosted-mixed`,
`CAPACITYLENS_MODE=password-and-sso`, a configured company provider and a current supported schema.
Stop the server first: the command refuses without the exact `--confirm-server-stopped` flag. It
locks and checks the database, refuses ambiguous identities and unsafe targets, and records
successful repairs in the audit outbox.

When preflight reports ready, set these values and restart:

```dotenv
CAPACITYLENS_MODE=sso-only
CAPACITYLENS_DEPLOYMENT_PROFILE=self-hosted-sso-only
```

Keep the Google credentials configured. After restart, sign-in and invitation acceptance need a
Google session
([Passwords and company sign-in](/company-login/#passwords-and-company-sign-in)).
There is no in-app readiness panel, so verify provider access directly before switching.

## Restore password sign-in

If Google becomes unavailable or someone cannot use their connected identity, set both values
and restart:

```dotenv
CAPACITYLENS_MODE=password-and-sso
CAPACITYLENS_DEPLOYMENT_PROFILE=self-hosted-mixed
```

Local-password accounts can sign in again, and Google sign-in stays available. This does not
reset passwords or change provider connections; use the ordinary password reset for a lost
password. A sole Owner who cannot use any available sign-in method can use the stopped-server
[Owner password recovery procedure](/self-hosting/incidents#the-sole-owner-has-lost-their-password).
