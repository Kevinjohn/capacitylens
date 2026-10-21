---
title: Privacy
description: What data CapacityLens stores, what stays in the browser, and what a self-hosting operator is responsible for.
---

# Privacy

**In short, for Owners.** Everyone in the company can see the schedule. Time-off notes are
limited to Owners and Admins, and the real names behind
[code names](/using/projects#hide-a-client-or-project-name) to the Owner. The data lives on your own server, so your installer or hosting provider can reach
it. Whoever runs that server is responsible for the data as its operator; the rest of this page
has the detail.

Use this page in a privacy assessment of the open-source application as shipped: what it stores,
what stays in the browser and what it sends. It is technical documentation, not legal advice. A hosted service needs its own privacy notice, retention terms, subprocessors and
data-processing agreements, and a professional privacy and security review before launch.

## Data the application stores

The SQLite database can contain company names, member names and email addresses, resource names,
projects, activities, bookings, time off and free-text notes. The authentication tables hold
identities, linked sign-in providers, sessions, invitations and password-reset state.

**Microsoft mailbox proof.** While an attempt is open, CapacityLens stores the intended email, the
Microsoft tenant and account identifiers, the attempt's status and expiry, a hash of the email
token and a hash of the source IP address for rate limiting. Return addresses for the attempt are
encrypted in the database. The link expires after 15 minutes; a successful proof is kept as the
person's Microsoft sign-in identity, so later sign-ins need no further proof.

**Sign-in confirmation.** An Owner can record whether each member has successfully signed in. It
is off by default. When on, CapacityLens stores one yes-or-no value per membership, not the time
or any site activity. Turning it off removes every live confirmation. Changing a membership's
access state, revoking a person's sessions or issuing a new password-reset link clears theirs
until they sign in again. Older backups may still hold earlier values.

**Invitations.** Used invitations are kept as history: at most the newest 200 per company, for no
longer than 365 days. An unused invitation follows its own expiry and can be revoked at any time.
Invitation links are stored only as digests and never shown again after creation.

**Audit log.** It records who changed which record and which fields, not the values. A short-lived
queue holds the same metadata in SQLite until it is durably written to disk, also without values.

**Backups.** Database snapshots contain the full database; protect them like the live data.

**Code names.** Clients and projects can have a private code name alongside the real name. This is
access control, not encryption: the real name stays in SQLite, in operator backups and in an
Owner's export. Only the Owner can read and manage real names and the code-name setting through
the API; Admins, Editors and Viewers see only the code name. An Admin who views the company as the
Owner sees what the Owner sees, including real names. A non-Owner's edits preserve the real fields
they were never shown.

## What stays in the browser

The local demo keeps scheduling data in memory only; it resets on refresh and is never sent
anywhere. Device preferences such as theme use the browser's localStorage and are not part of a
company export.

[Offline access](/using/settings#offline-access) is optional. When on, it stores your last verified
identity, your list of companies and a snapshot of each company's data in the browser's IndexedDB
for up to seven days. Snapshots are read-only and never queue changes. Signing out clears your own
cached snapshots; Settings has no control to clear all CapacityLens preferences and snapshots from
the browser profile.

Snapshots are encrypted with a key that lives only in that browser and cannot be extracted, but
anyone using the unlocked browser profile signed in as you can still trigger it. A snapshot holds
whatever the server shows that person, so an Owner's may contain real private names behind code
names. Protect the device like a signed-in session.

## Network behaviour

CapacityLens includes no product analytics, advertising or crash-reporting service, and its
authentication library's telemetry is turned off. Scheduling requests normally go to the
application server on the same origin. External avatar URLs make the browser fetch images from
that image host.

**Email.** When SMTP is configured, CapacityLens sends addressed invitations and self-service
password-reset links through the operator's SMTP service. Messages contain the recipient's address
and a bearer link. Reset links are single-use and expire after 24 hours. Unknown addresses and
accounts using only company sign-in get no reset email, and Admin-issued reset copy-links send no
email. If Microsoft sign-in is configured and Microsoft does not return a verified matching email,
the same service sends the mailbox proof to the intended CapacityLens address, with a link that
expires after 15 minutes. The operator is responsible for the SMTP provider's processing and
retention.

**Breached-password check.** When a password is created, changed or reset, the server checks it
against the Have I Been Pwned list by default. It sends only the first five characters of a
SHA-1 hash of the password, never the password or the full hash, and never during ordinary
sign-in. If the check is unavailable, the password change is refused rather than skipped. An
isolated non-production deployment can turn it off; a production deployment that does so gets a
startup warning. Include this outbound check in your network and privacy assessment.

**Company login.** With [company login](/company-login/) on, your browser goes to Google or
Microsoft to sign in, and the server exchanges the result for a session. That provider processes
your identity data, so review its privacy terms. The Microsoft integration fetches the person's
photo from Microsoft Graph on the server, even though it cannot be used as an avatar
([Permissions, consent and profile pictures](/company-login/set-up-company-login#permissions-consent-and-profile-pictures)).

## Keeping and deleting data

- Deleting a person, client or project immediately replaces its name with an anonymised label and
  clears notes from its bookings and time off.
- Permanently deleting a company removes its scheduling data and erases any identity that no
  longer belongs to another company, including that identity's sessions and linked providers.
- An identity used by more than one company is kept while any of those memberships needs it.
- Deleting a live record does not change audit files, existing backups or off-host copies. The
  operator needs a separate process to remove data from them.

## Who is responsible for what

For a self-hosted install, the operator decides the purpose, lawful basis, access, retention,
backup policy and access control, which in most privacy frameworks makes them the data controller.
Protect the SQLite database, audit log, backup snapshots, staff devices and identity-provider
credentials accordingly. The [Self-hosting](/self-hosting/) guide covers each.
