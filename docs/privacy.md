# Privacy

This page describes the open-source application as shipped. A hosted service will need its own
privacy notice, retention terms, subprocessors and data-processing agreements.

## Data the application stores

The SQLite database can contain account names, member names/email addresses, resource names,
projects, activities, allocations, time off and free-text notes. Authentication tables contain
identities, linked providers, sessions, invitations and password-reset state.

Used invitations are retained as bounded operational history: at most the newest 200 per company
and for no longer than 365 days. Live unused invitations are instead governed by their configured
expiry and explicit revocation. Invitation bearer tokens are stored only as digests and are never
returned by management reads.

The audit log records who changed which entity and field names, but not field values. Pending
mutation-audit records temporarily retain that same metadata in SQLite until fsynced JSONL delivery;
they still contain no entity values. Online database snapshots contain the full database and must
be protected like production data.

Clients and projects can optionally store a code name alongside the real name. This is an access-
control feature, not database encryption: real names remain in SQLite, operator backups and owner
exports. Authenticated API reads expose real names and raw code-name settings only to the account
owner; admins, editors and viewers receive only the quoted code-name projection. Their writes also
preserve the protected fields they were not allowed to read. Whole-slice server imports are
owner-only because a non-owner export deliberately lacks the protected identity fields required for
a lossless restore.

## Browser storage

The demo stores scheduling data only in memory and resets on refresh. Device preferences use
localStorage and are not part of an account export.

Optional offline reading stores the last verified identity, account list and account snapshots in
IndexedDB with a seven-day expiry, plus an application-shell cache. Before any later cache read or
write, maintenance physically removes expired envelopes. It is read-only and never queues writes.
Snapshot records are encrypted with a non-extractable per-browser key, but access to an unlocked
application origin can still invoke that key. Sign-out removes the current user's cached snapshots;
opting out or using “Clear device data” removes every user's CapacityLens cache and its device key
from that browser profile. See `docs/offline.md`.

Offline snapshots contain the same role-filtered payload last returned by the server: a non-owner's
snapshot contains code names, while an owner's snapshot may contain real private names. Protect an
owner's browser profile accordingly.

## Network behavior

CapacityLens includes no product analytics, advertising, crash-reporting service or outbound email
service. Better Auth telemetry is disabled. The browser API policy is same-origin.

When password creation/change/reset is enabled, the server checks candidate passwords through the
Have I Been Pwned Pwned Passwords range API by default. It sends the first five hexadecimal
characters of the password's SHA-1 digest, with padded responses enabled; it never sends the
password or complete digest. The lookup occurs only while setting a credential, not during normal
sign-in. It fails closed when unavailable. Non-production isolated deployments can set
`SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK=off`; production supports that opt-out with a startup warning.
Operators should include this outbound security service in their network/privacy assessment.

If an operator enables social/OIDC sign-in, the browser navigates to that chosen identity provider
and the server performs the token exchange. The provider then becomes a processor for identity
data. Operators should review that provider's own terms and retention behavior.

## Retention and erasure

- Soft-deleting a resource immediately replaces its name with a stable anonymised label and removes
  notes from dependent allocations and time off. Import repair applies the same rule before storing
  a deleted resource from legacy, restored or hand-edited data.
- Permanently deleting an account removes its scoped scheduling data and erases identities that no
  longer belong to another account, including sessions and provider links.
- Audit files and backup snapshots are separate copies. Operators must include their retention,
  off-host copies and restore media in an erasure process; deleting the live row does not rewrite
  an existing backup.
- Multi-account identities are retained while another membership needs them.

## Operator responsibility

For a self-hosted deployment, the operator determines purpose, lawful basis, users, retention,
backups and access policy and is generally the data controller. Protect the SQLite database, audit
log, snapshots, browser devices and identity-provider credentials accordingly.

This is technical documentation, not legal advice. A commercial hosted service should receive a
professional privacy/security review before launch.
