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
identities, sessions, invitations, admission requests and decisions, and emailed-link state.
Session records include a browser user-agent label of up to 200 characters, creation time,
last-seen time and expiry. The product has no screen for viewing or revoking another member's
sessions.

**Sign-in confirmation.** An Owner can record whether each member has successfully signed in. It
is off by default. When on, CapacityLens stores one yes-or-no value per membership, not the time
or any site activity. Turning it off removes every live confirmation. Changing a membership's
access state clears theirs until they sign in again. Older backups may still hold earlier values.

**Invitations.** An unused invitation expires after seven days and can be revoked at any time.
Invitation links are stored only as digests and never shown in the app.

**Audit log.** Transactional audit rows record who changed which record and which fields, not the
values. They remain in SQLite with the company data; database backups can contain them. Sign-in
success, failure and throttling outcomes are not recorded in the application audit table.

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

Scheduling data and verified identities are never saved as persistent browser snapshots. A server
failure stays visible and retryable. Nothing is queued for a later connection.

When opening a version that removes the former snapshot feature, the app deletes its old browser
database and shell caches and unregisters its worker. Close older CapacityLens tabs and reopen the
app if another tab is holding that database open.

## Network behaviour

CapacityLens includes no product analytics, advertising or crash-reporting service. Scheduling
requests normally go to the application server on the same origin. External avatar URLs make the
browser fetch images from that image host.

**Email.** CapacityLens sends invitations, address confirmations and password-reset links through
the operator's SMTP service. Messages contain the recipient's address and a single-use bearer
link. Invitation links expire after seven days; address-confirmation and reset links expire after
one hour. The product does not expose an email-change route. Unknown addresses get no reset email.
The operator is responsible for the SMTP provider's processing and retention.

## Keeping and deleting data

- Anonymising a resource replaces its name and role with obfuscated labels, removes its avatar,
  and clears notes from its bookings and time off. The resource and its links remain.
- **Anonymise all people** applies the same scrub to every resource. Client, project and activity
  catalogue fields, the company, Owner, memberships and planning links stay unchanged.
- Anonymisation does not change audit rows in SQLite, existing backups or off-host copies. The operator
  needs a separate process to remove data from them.

## Who is responsible for what

For a self-hosted install, the operator decides the purpose, lawful basis, access, retention,
backup policy and access control, which in most privacy frameworks makes them the data controller.
Protect the SQLite database, `APP_KEY`, SMTP credentials, backup snapshots and staff devices
accordingly. The [Self-hosting](/self-hosting/) guide covers each.
