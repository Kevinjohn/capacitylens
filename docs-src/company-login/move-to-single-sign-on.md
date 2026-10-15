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

## Require company sign-in

Before switching modes, verify Google sign-in for every member who needs access, including every
Owner. Connect each existing password account to its matching verified Google address while
password sign-in is still available. Keep a backup and an operator recovery route.

The retired server's preflight and repair commands are not part of the current application.
There is no automatic all-company readiness check. Verify the actual provider and membership
access before changing these values and restarting:

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
