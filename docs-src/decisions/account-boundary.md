# Account boundary architecture

> Status: implemented with Account Kit (`@kevinjohn/adonisjs-account-kit`), password sign-in only

## Outcome

Account Kit owns identities, password credentials, sessions, emailed links (address confirmation,
password reset, email change and invitations) and admission. Access Control
(`@kevinjohn/adonisjs-access-control`) stores company memberships and applies the generic role and
membership rules. CapacityLens owns companies, its membership policy, the role permissions it
declares and every scheduling table. The integration uses the Kit's configuration in
`apps/backend/config/account_kit.ts` and `apps/backend/config/admission.ts`, and the callbacks in
`apps/backend/app/services/account_kit/`, as well as ordinary calls to the Kit's public API from
application controllers and services.

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

## Access Control

- **What the package decides.** Membership storage in `company_memberships`, the role order viewer
  < editor < admin < owner, which role holds each permission key, which roles an actor may assign,
  and the management rules: nobody manages their own membership (so a member cannot change their own
  role), nobody manages the Owner or assigns Owner through ordinary management, and an Admin may
  manage another Admin. The Owner role moves only by ownership transfer.
- **What CapacityLens keeps.** The permission declaration in
  `packages/shared/src/account/permissions.ts`, the configuration in
  `apps/backend/config/access_control.ts`, access restrictions, audit, planning revisions, command
  receipts, the view-as checks and identity-administration rules. Product status "archived" is the
  package's suspended membership; a disabled access is a separate restriction.
- **Transaction composition.** Every membership operation runs inside the product's
  single-connection transaction, with that transaction passed to the package. The package never
  opens a second transaction or connection, so authorization, membership write, audit and revision
  commit or roll back together. This composition is documented and tested for SQLite only.
- **One Kit module instance.** The application and Access Control resolve the same Account Kit
  module, so they share one transaction nesting guard.

## First identity

The operator command `node ace.js account-kit:admission:bootstrap <email> --role=viewer` prints a
one-time link. The bootstrap role grants nothing on its own; the person who accepts the link creates
the company and becomes its Owner.

## Member-to-resource links

The `account_member_resources` control table links one member to one scheduled person for avatar
presentation. It has no foreign keys into scheduling data: member removal unlinks the association.
Ordinary product writes keep resource kind immutable; the database cleanup trigger also removes a
link if a stored person resource changes to another kind. The scheduling graph uses database
triggers to reject cross-company references; control links are instead validated transactionally.
Imports preserve valid links and check their references in the import transaction. Archived and
anonymised resources and their links remain stored. The ordinary read surface exposes only
`{ resourceId, imageUrl }` for active, validated links.

## Known accepted limits

- There is no administrative password reset or session revocation for another member.
- Identities are never merged by email.
