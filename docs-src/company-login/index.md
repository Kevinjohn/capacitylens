---
title: How sign-in works
description: Sign in with a password, Google Workspace or Microsoft, connect an existing account, and manage access safely.
---

# How sign-in works

CapacityLens can use passwords, Google Workspace or Microsoft Entra ID. The person running the
server chooses which appear. The demo and trusted-local mode have no sign-in.

With company sign-in, CapacityLens sends you to Google or Microsoft and never sees your provider
password. A provider account alone does not grant access: the first person on an empty
installation needs operator approval, and after that each company decides who may join.

## Passwords and company sign-in

![Sign-in screen with configured providers above the password form](../screenshots/company_sign_in_password.png)

In password-and-sso mode, each configured provider appears once, stacked above the password form
with an **or use your password** divider between them. GitHub is an experimental extra option in
this mode only. Provider-only sign-in shows no password form; password-only sign-in shows no
provider area.

First-owner setup has its own field order. Microsoft setup, for example, asks for an email address
before the provider step so it can run its mailbox proof.

In company-sign-in-only mode, people must use Google or Microsoft. Passwords and GitHub, including
older sessions, cannot satisfy it. Keep the chosen provider's credentials configured when changing
modes.

[Set up Google or Microsoft sign-in](/company-login/set-up-company-login) covers registration and
server settings. [Require company sign-in](/company-login/move-to-single-sign-on) covers switching
everyone to a provider.

## Invitations and the first Owner

On an empty installation, the operator can allow specific email addresses to create the first
Google or Microsoft identity. That person follows **Set up your company** to become its Owner.
The allowance closes once the first identity exists.

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

Sign in to your existing account, open **Account → Security** and, under **Company sign-in**,
choose **Connect Google** or **Connect Microsoft**. Sign in at the provider with the same email
address. Your local email must already be verified, and you may be asked to confirm it's you.

Connecting keeps your memberships and work. CapacityLens never merges accounts because their email
addresses match, and a provider identity already connected to someone else cannot be connected
again.

Microsoft may send a one-time link to prove you control the mailbox. Open it in the same browser
within 15 minutes, then select **Confirm and continue**. Returning Microsoft sign-in uses the saved identity and does not repeat the
check. See [Microsoft mailbox proof](/company-login/set-up-company-login#microsoft-mailbox-proof).

If something goes wrong:

- **You cancel Confirm it's you.** No connection starts.
- **Confirmation cannot refresh your session.** Sign out, sign in again and retry.
- **Your local email is unverified.** The operator confirms which mailbox you control, then an
  authorised Owner or Admin runs the guarded repair in mixed mode. They need a recent confirmed
  sign-in and authority over your identity across its companies. The repair revokes your
  sessions; sign in again afterwards. There is no email-correction button in Account, and the
  joining verification link does not verify your local email. See
  [Connect existing accounts](/company-login/move-to-single-sign-on#connect-existing-accounts).

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

Disable their work account at the provider, then remove their membership or select **Disable
Access** in **Team & access**. Disabling them at the provider does not end existing CapacityLens
sessions: use **Revoke sessions** to end them across all their companies, which needs the
corresponding authority. In mixed mode, a verified GitHub sign-in is also bound by a **Disable
Access** restriction on the selected address.
