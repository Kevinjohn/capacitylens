---
title: Company login
description: Sign in with a password, Google Workspace or Microsoft, connect an existing account, and manage access safely.
---

# Company login

Sign in with a password, Google Workspace or Microsoft Entra ID, whichever the installer has
turned on. The demo, and an installation with `CAPACITYLENS_MODE=off`, have no sign-in.

With company login, CapacityLens sends you to Google or Microsoft and never sees your provider
password. A provider account alone does not grant access: the first person on an empty
installation needs the installer's approval, and after that each company decides who may join.

## Passwords and company sign-in

![Sign-in screen with configured providers above the password form](../screenshots/company_sign_in_password.png)

In mixed mode (`password-and-sso`), each configured provider appears once, stacked above the password form
with an **or use your password** divider between them. GitHub is an experimental extra option in
this mode only. Provider-only sign-in shows no password form; password-only sign-in shows no
provider area.

First-Owner setup has its own field order. Microsoft setup, for example, asks for an email address
before the provider step so it can run its mailbox proof.

When company login is required (`sso-only`), people must use Google or Microsoft. Passwords and GitHub, including
older sessions, cannot satisfy it.

[Set up Google or Microsoft sign-in](/company-login/set-up-company-login) covers registration and
server settings. [Require company sign-in](/company-login/move-to-single-sign-on) covers switching
everyone to a provider.

## Invitations and the first Owner

On an empty installation, the installer can allow specific email addresses to create the first
Google or Microsoft identity. That person follows [Set up your company](/owner/) to become its
Owner. The allowance closes once the first identity exists.

After that, the Owner chooses **Who can join** in **Team & access**: **Invitation only** (the
default), open registration, approved email domains, or approved domains plus invitations. An
Admin can see the policy and ask the Owner to change it. Joining through a policy gives Viewer
access; an addressed invitation can grant its chosen role. **Approved domains** match exactly, so
`team.example.com` is not `example.com`.

To join, open the company's joining link and choose a sign-in method. An existing password user
signs in first, then selects **Join company**. The server admits only identities with current
trusted email proof that meet the company's policy:

- Password signup through an open or domain policy is not available.
- When email delivery is enabled, a password user can choose **Email me a verification link** and
  open it within 60 minutes while signed in to join through an open or approved-domain policy.
- Microsoft may use its same-browser mailbox check when the address is not already proven.
- An invitation must be addressed to the verified email.

A company can disable someone's access even when its joining policy allows them.

## Connect an existing account

1. Sign in to your existing account and open **Account → Security**.
2. Under **Company sign-in**, choose **Connect Google** or **Connect Microsoft**. You may be asked
   to confirm it's you.
3. Sign in at the provider with the same email address. Your local email must already be verified.

Connecting keeps your memberships and work. CapacityLens never merges accounts because their email
addresses match, and a provider identity already connected to someone else cannot be connected
again.

Microsoft may send a one-time link to prove you control the mailbox. Open it in the same browser
within 15 minutes, then select **Confirm and continue**. Returning Microsoft sign-in uses the saved
identity and does not repeat the check.
[Microsoft mailbox proof](/company-login/set-up-company-login#microsoft-mailbox-proof) covers what
to do when the email does not arrive or the link expires.

### If connecting fails

- **You cancel Confirm it's you.** No connection starts.
- **Confirmation cannot refresh your session.** Sign out, sign in again and retry.
- **Your local email is unverified.** There is no email-correction button in Account, and the
  joining verification link does not verify your local email. Ask your installer. They confirm you
  own the mailbox, and an Owner or Admin then runs the repair in
  [Connect existing accounts](/company-login/move-to-single-sign-on#connect-existing-accounts). The
  repair signs you out everywhere, so sign in again before retrying.

## Sessions and sensitive actions

<span id="sessions-and-staying-signed-in"></span>

A session lasts at most twelve hours from sign-in; activity does not extend it. Thirty minutes
without activity also signs you out.

These actions ask you to confirm your identity again when needed: connecting or repairing a
company identity, transferring ownership, resetting another member's password, revoking another
member's sessions, deleting a company, and importing or purging company data. Invitations, role
changes and removing members need only the right role.

If confirming through Google or Microsoft takes you away from the page, return and submit the
action again. Confirming does not apply the original change.

## Multi-factor sign-in at your provider

CapacityLens has no local MFA. If your agency requires MFA, set it up at Google or Microsoft.
Enabling company sign-in does not turn it on, and CapacityLens cannot see or enforce the
provider's policy or tell whether a challenge happened. Test the policy, its recovery path and
session behaviour before relying on it.

## When someone leaves

1. Disable their work account at the provider.
2. In **Team & access**, remove their membership or select **Disable Access**.
3. Select **Revoke sessions** to end their existing CapacityLens sessions across all their
   companies. This needs the corresponding authority. Disabling them at the provider does not end
   those sessions.

In mixed mode, a verified GitHub sign-in is also bound by a **Disable Access** restriction on the
selected address.

## If someone returns with a new sign-in

A **Disable Access** restriction follows a new sign-in with the same address only when both
identities proved mailbox ownership, through verified company sign-in or a completed mailbox check.
An invitation or an older "email verified" flag does not count. An established Microsoft sign-in
keeps its stable identity, but a returning sign-in does not add mailbox proof to an older identity
without it. An Owner or Admin can still manage the original restriction from **No longer active**
in **Team & access**.
