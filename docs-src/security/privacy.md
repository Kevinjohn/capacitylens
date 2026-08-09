---
title: Privacy
description: What data CapacityLens stores, what stays in the browser, and what a self-hosting operator is responsible for.
---

# Privacy

This page describes the open-source application as shipped. A hosted service would need its own
privacy notice, retention terms, subprocessors and data-processing agreements — this page is not
that. It is technical documentation, not legal advice, and a commercial hosted service should get
a professional privacy/security review before launch.

## Data the application stores

The SQLite database can contain company names, member names and email addresses, resource names,
projects, activities, allocations, time off and free-text notes. The authentication tables
contain identities, linked sign-in providers, sessions, invitations and password-reset state.

Used invitations are kept as bounded history: at most the newest 200 per company and no longer
than 365 days. A live, unused invitation instead follows its own expiry and can be revoked at any
time. Invitation links are stored only as digests and are never shown again once created.

The audit log records who changed which record and which fields, but not the values that
changed. A short-lived queue holds that same metadata in SQLite until it is durably written to
disk; it never holds the values either. Database snapshots (backups) contain the full database
and must be protected the same way as the live production data.

Clients and projects can optionally have a private code name alongside the real name — this is an
access-control feature, not encryption. The real name still lives in SQLite, in operator backups
and in an owner's export. Only the Owner can read and manage the real names and the
code-name setting through the API; everyone else (admins, editors, viewers) sees only the code
name. A non-owner's own edits preserve the real fields they were never shown.

## What stays in the browser

The public demo keeps its scheduling data in memory only — it resets on refresh and is never sent
anywhere. Ordinary device preferences (like theme) use the browser's localStorage and are not
part of a company export.

[Offline access](/guide/offline-access) is optional. When turned on, it stores your last verified
identity, your list of companies and a snapshot of each company's data in the browser's IndexedDB,
for up to seven days. Signing out clears your own cached snapshots; using "Clear device data"
clears every CapacityLens user's cache from that browser profile. The offline snapshot is
read-only — it never queues changes to send later — and is encrypted with a key that lives only in
that browser and cannot be extracted from it. That said, anyone who can use an unlocked browser
profile signed in as you can still trigger that key, so protect the device the same way you would
protect a signed-in session.

An offline snapshot contains whatever the server would normally show that person: a non-owner
sees code names, while an Owner's snapshot may contain real, private names. Protect an
owner's laptop or browser profile accordingly.

## Network behaviour

CapacityLens includes no product analytics, advertising, crash-reporting service or outbound
email service, and telemetry from its authentication library is turned off. The browser only
talks to its own server (same-origin).

When password creation, change or reset is turned on, the server checks the candidate password
against the Have I Been Pwned breached-password list by default. It sends only the first five
characters of a scrambled (SHA-1) version of the password — never the password itself or the
full scrambled value — and this check only happens while setting a password, not during normal
sign-in. If that check is unavailable, the password change is refused rather than skipped. An
isolated, non-production deployment can turn this check off; a production deployment that does so
gets a startup warning. If you self-host, include this outbound check in your own network and
privacy assessment.

If an operator turns on [company login](/company-login/) (social or OIDC sign-in), your browser
is sent to that identity provider to sign in, and the server exchanges the result for a session.
That provider becomes a processor of your identity data, so review its own privacy terms.

## Keeping and deleting data

- Deleting a resource (a person, client or project) immediately replaces its name with an
  anonymised label and clears notes from its allocations and time off.
- Permanently deleting a company removes its scheduling data and erases any identity that no
  longer belongs to another company, including that identity's sessions and linked providers.
- Audit files and backups are separate copies. Deleting a live record does not rewrite an
  existing backup — an operator needs a separate process to remove data from backups and
  off-host copies.
- An identity used by more than one company is kept as long as any of those memberships needs it.

## Who is responsible for what

For a self-hosted install, the operator decides the purpose, the lawful basis, who has access,
how long data is kept, backup policy and access control — in most privacy frameworks, that makes
the operator the data controller. Protect the SQLite database, the audit log, backup snapshots,
staff devices and identity-provider credentials accordingly. See
[Self-hosting](/self-hosting/) for the deployment side of this responsibility.

## What's next

Read the [Security overview](/security/) for the security defaults, or go to
[Reviews and compliance](/security/reviews) for the detailed evidence behind these claims.
