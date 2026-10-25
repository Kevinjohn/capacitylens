# Account boundary architecture

> Status: implemented with Account Kit (`adonisjs-account-kit`), password sign-in only

## Outcome

Account Kit owns identities, password credentials, sessions, emailed links (address confirmation,
password reset, email change and invitations) and admission. CapacityLens owns companies,
memberships, roles and every scheduling table. The two meet only through the Kit's configuration in
`apps/backend/config/account_kit.ts` and `apps/backend/config/admission.ts`, and the callbacks in
`apps/backend/app/services/account_kit/`.

Both sides share one process, one SQLite file and one migration ledger. There is no separate
account service or database.

## What CapacityLens decides

- **Invitation authority.** An active, admitted Owner or Admin may invite, list and manage
  invitations. The role is re-read inside the Kit's insert transaction, so a demotion committed
  while an invitation waits for the write lock refuses the send. Invitations never carry Owner.
- **Acceptance.** `onInvitationAccepted` creates the invited membership, writes the audit entry and
  advances the planning revision in the Kit's acceptance transaction. An address the company removed
  cannot rejoin. Before the first company exists the accepted identity is the Owner-to-be, and
  company setup grants Owner.
- **Admission decisions.** Owners and Admins approve, reject or revoke, never for someone their
  role cannot administer. Approval is required in addition to invitation evidence; the optional
  domain allow-list is `CAPACITYLENS_ALLOWED_EMAIL_DOMAINS`.
- **Credential changes.** `onCredentialsChangedTransaction` records the change against every company
  the identity belongs to.

## What the Kit decides

Password policy bounds, link lifetimes (invitations last seven days), throttling, session idle
expiry (fourteen days), ending every session on a credential change, and mail delivery. Every
emailed flow needs `CAPACITYLENS_MAIL_HOST`; without it, sending an invitation refuses with
`MAIL_UNAVAILABLE`. Production action links require an HTTPS public origin.

## First identity

The operator command `node ace.js account-kit:admission:bootstrap <email> --role=viewer` prints a
one-time link. The bootstrap role grants nothing on its own; the person who accepts the link creates
the company and becomes its Owner.

## Member-to-resource links

The `account_member_resources` control table links one member to one scheduled person for avatar
presentation. It has no foreign keys into scheduling data: member removal, resource purge and
imports reconcile it explicitly in their owning transaction. The ordinary read surface exposes only
`{ resourceId, imageUrl }` for active, validated links.

## Known accepted limits

- There is no administrative password reset or session revocation for another member.
- Identities are never merged by email.
