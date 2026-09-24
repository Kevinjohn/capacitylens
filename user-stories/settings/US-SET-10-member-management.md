# US-SET-10 — Member management (Owner/Admin invite / list / role / revoke)

**Area:** Team & access · **Persona:** Studio owner / admin · **Linked E2E:** `e2e/members.auth.spec.ts` → "admin manages members but not owner-only ops; ownership changes only by transfer; no cross-tenant leak"

## Goal

Let an Owner or Admin manage who can access their company from Team & access: see the member list, invite
people (a link, optionally pre-authorised to one email), change a member's role, disable or restore a
member's access, remove a member, and list/revoke outstanding invites. An Admin manages members but
cannot do owner-only operations. Sign-in tracking remains a server capability, but its controls and
status column are unavailable in this UI. Ownership transfer is not part of this story: it has no per-row control
(since #175) and now has its own three-step ceremony and section — see
[US-SET-18](US-SET-18-ownership-transfer.md).

**Guide:** [Invite your team](../../docs-src/getting-started/invite-your-team.md) and
[Company sign-in](../../docs-src/company-login/set-up-company-login.md).

An Owner or Admin opens **Team & access** from the sidebar. Linking, changing or removing a
Resource association and creating invitations happen only here. Navigation does not submit a
command or carry a Resource or invitation selection.

## Why

On an auth-enabled, server-backed deploy, access to a company is a real membership (a role per login),
so the people who run a company need a place to grant, adjust, and revoke that access without touching
the database. Team & access is visible to every role so a Viewer/Editor can understand their own
limits; management controls remain Owner/Admin-only. Ownership moves only through its own consent ceremony
(US-SET-18), and the database prevents a second active Owner. Disabling is the reversible middle ground between
"nothing changed" and "removed": a **disabled** or **archived** membership keeps its role and history
but authorizes nothing, because every server-side authorization read narrows on an _active_ row.
Invites reuse the P1.9 single-use link: the secret token is shown once at creation, stored only as a
one-way hash, and never read back, so listing or revoking invites can never leak a live, role-bearing
link.

An Owner or Admin can also associate one active member with one active person Resource. Team & access
shows the resource name or **None** and offers a separate link icon that opens a centered Resource-link
dialog with the selector ready. A selection saves immediately, and a linked member has a
**Remove link to resource** action. The association does not grant access or create
schedule data. Archived or disabled members and Resources retain an existing association for
status and removal, but cannot be new or changed targets. When the member has a validated sign-in
picture, the schedule uses it only if the person has no explicit avatar URL; inactive endpoints show
no derived picture. Unlinking returns the person to their explicit avatar, or initials when none is set.

When creating an invitation, an Owner or Admin may choose **Link to Resource** or leave the
default **No Resource linked**. The choice is not reserved. On admission CapacityLens links the
person if it is still available; otherwise the member directory shows **Resource link needs
attention** in the member row, with **Choose another person** and **Dismiss** controls available
from the centered member dialog. Invitees never see the
proposal or exception.

The **Members management section** is a server + auth-on feature only. With auth off or in the
in-memory demo, **Team & access** still explains the access posture and member/resource distinction,
but no directory or management controls exist.

## How (end-to-end)

**Precondition:** The app runs in its default server mode against a server with
`SMALLSASS_ACCOUNT_MODE=password`. Same-origin `/api` needs no frontend API setting; set
`VITE_CAPACITYLENS_API` only when the API uses a different origin. Owner A has created a company and
invited Admin B and Editor C (both accepted). Sign in as **B (admin)** and pick the company. Dismiss
the non-blocking product orientation if it is open.

1. Open **Team & access** (sidebar). **Your access** summarises the caller's role in a sentence; the
   full capability tick list is collapsed behind **See full capabilities**
   (`data-testid="capabilities-toggle"`), so the page opens on management rather than on reference
   material. Below it, **Invite someone** appears before the **Members** section
   (`data-testid="members-section"`, heading **Members**).

   Loading the directory is a read-only operation: an Owner or Admin can review members and
   outstanding invites from an older session without a confirmation prompt. A
   fresh identity confirmation appears only after starting a sensitive change, and its heading names
   that exact action. Cancelling the confirmation leaves this page and its loaded directory available.

2. The **member list** is a table (`data-testid="members-table"`) with the five columns **Name**,
   **Role**, **Email**, **Link to Resource**, and **Actions**, one row per member
   (`data-testid="member-row"`); B's own row is marked **(you)**. Active and inactive tables use
   the same columns. Rows are ordered by role priority **Owner**, **Admin**, **Editor**, **Viewer**,
   then display name and stable member ID; disabled and archived memberships are grouped below it
   behind a collapsed **No longer active (_count_)** disclosure
   (`data-testid="members-inactive-toggle"`) that reveals a second table
   (`data-testid="members-inactive-table"`) whose rows carry a **Disabled**/**Archived** badge.
   Email cells contain the complete address in the DOM and in a native `title`, while CSS truncates
   the visual text to the available column width.
3. Each manageable row ends in distinct controls, each naming their member for screen readers: an eye for
   masquerade (`data-testid="member-masquerade"`), a pencil (`data-testid="member-edit"`) that opens the
   **Change member role** dialog, a link icon (`data-testid="member-resource-menu"`) that opens the centered
   Resource-link dialog, and a settings icon (`data-testid="member-menu"`) that opens the centered **Member
   actions** dialog. The invoking triggers remain mounted and the Actions column keeps its width while
   either dialog is open. Closing by its footer action, Escape, or backdrop restores focus to that row
   trigger; a confirmation opened from Member actions receives focus instead of returning focus behind it.
   All row controls are disabled while any member mutation is in flight.
4. B clicks **C**'s pencil, chooses Viewer in the dialog's role select
   (`data-testid="member-role-select"`), reads the plain-language summary of what Viewer can and
   cannot do, and clicks **Save role** (`data-testid="member-role-save"`).
5. B opens **C**'s member-actions dialog. It holds **Reset password** (US-SET-13), **Revoke sessions**, **Disable
   user** (`data-testid="member-disable"`), **Archive user** (`data-testid="member-archive"`) and
   **Remove** — each behind an explicit confirmation naming C. Once C is disabled, C's row moves into
   the **No longer active** group and C's dialog offers **Restore access**
   (`data-testid="member-restore"`) in place of disable/archive. C stays listed there, so the
   operation is visible and reversible, but every read C attempts against the company is refused by
   the server.
6. B selects the primary **Invite someone** button above the member table to open a centered dialog,
   then picks a role (`data-testid="invite-role"`), fills **Email** when needed
   (`data-testid="invite-preauth"`), checks the selected role's visible
   capability summary, and clicks **Create invite**
   (`data-testid="invite-submit"`). The full link `<origin>/invite/<token>` appears **once**
   (`data-testid="invite-link"`) with a visible **Copy** button whose accessible name is
   **Copy invitation link**. That write-once block disappears when the dialog closes or an
   authoritative refresh reports that the invite was revoked, used or is missing, so the UI never
   offers a dead bearer link. If the dialog closes before the create completes, the invite still
   exists, and a notice says its link was not shown and how to replace it.
7. The outstanding invitations use the same five-column bordered table as Members: **Name** is an
   em dash, **Role** is the invited role, **Email** is the pre-authorised address or **Invite link**,
   **Link to Resource** is the proposed resource or **None** with compact pending state, and
   **Actions** contains **Revoke** (`data-testid="invite-revoke"`) when allowed. Email cells retain
   the complete value in the DOM and `title` while CSS truncates the display. The table shows the new
   invite and the admin/editor invites B and C already accepted — an accepted invite stays listed
   **marked used** (so an admin can confirm it was taken; only an expired, unaccepted link is pruned).
   B clicks **Revoke** on the newest and its row goes away.
8. B never sees an **Owner** option (neither in a role select nor the invite-role picker), no
   **Transfer ownership** button on any row — since #175 no row offers one to anyone — and owner A's
   row shows B neither a pencil nor a more-actions button (an Admin can't touch an owner). Signed in as A, that same
   row keeps a more-actions button holding only the self-service **Reset password** and **Revoke sessions**: nobody
   can disable an Owner, or themselves. See US-SET-13 for the reset-link flow itself.
9. **Ownership transfer** is not reachable from the member table at all. Its own **Company ownership**
   section below opens the three-step ceremony in a modal the nominated Admin must agree to —
   see [US-SET-18](US-SET-18-ownership-transfer.md).
10. Team & access does not render **Record member sign-ins** or a **Signed in** column, even when
    the stored server setting is enabled. The server API, storage, and audit behavior remain
    available for a later UI reconsideration; no sign-in status is exposed by this page.

## Acceptance criteria

- **Team & access** renders for every role and distinguishes the in-memory **Demo access** posture
  from a persisted auth-off server's **Open access** posture. The **Members** management section
  renders only in server + auth-on mode for an Owner/Admin; a Viewer/Editor sees their role
  explanation but no member directory or controls.
- The member and outstanding-invitation lists use the same five-column table: **Name**, **Role**,
  **Email**, **Link to Resource**, and **Actions**. Active and inactive member tables share the
  same structure and status treatment. Members sort by role priority **Owner**, **Admin**, **Editor**,
  **Viewer**, then display name and stable member ID. Invitations use role priority followed by email,
  creation order, and invitation ID as deterministic fallbacks. Unlinked resources display **None**.
  Email cells retain the complete address in the DOM and a native `title` while CSS truncates the
  visual text; missing or malformed legacy values do not throw.
- Team & access never renders the sign-in-tracking switch or **Signed in** column, regardless of the
  stored setting. The server routes, storage, and audit behavior remain intact for possible later use.
- The main table lists only active members. Disabled and archived memberships appear under a
  **No longer active (_count_)** disclosure that is **collapsed by default**, reports its state
  through `aria-expanded`, badges each row **Disabled** or **Archived**, and is absent entirely when
  no membership is in either state.
- The capability tick list is collapsed by default and toggles from a single control that reports its
  state through `aria-expanded`.
- The Resource Link dialog opens with its selector ready and saves a changed selection immediately.
  It presents a proper **Remove link to resource** button when linked, preserves exceptional-state
  recovery actions, and does not add a separate Save action. Its row trigger remains mounted and
  focus returns to that trigger when the dialog is dismissed.
- The Member actions dialog keeps its row trigger mounted and the action-cell layout stable. Footer
  Close, Escape, and backdrop dismissal restore focus to the trigger; confirmations receive focus
  while they are open. Existing lifecycle actions, confirmations, permissions, and mutation behavior
  remain unchanged.
- Disable, archive and restore are offered only where `canChangeMemberStatus` allows them — never
  against the Owner and never against yourself — and the server refuses both cases with **403**
  independently of what the UI renders. A non-active membership authorizes nothing: the member's own
  reads against the company return **403** until they are restored, while the administrative
  directory keeps listing them so the change is visible and reversible.
- A non-active membership cannot be reversed by its holder. Redeeming an invite for a company where the
  caller's membership is disabled or archived is **403**, leaves the membership untouched and leaves
  the invite **unused** — only an Owner/Admin restores access, and the restore is audited as
  `member.status_changed`.
- Disabling someone never costs an administrator the ability to act on them: **Reset password** and
  **Revoke sessions** stay available against a disabled or archived member (the compromised-account
  case is precisely why an admin disables first), and **Remove** works on a non-active row without
  first restoring its access. The role **pencil** is the one exception — it is offered on active rows
  only, so a role change can never quietly reinstate a disabled member.
- Re-applying the status a member already holds succeeds (**200**) and changes nothing: it must not
  burn that member's outstanding password-reset link or bump their security revision, so a second
  admin acting on a stale screen cannot silently kill a link the first admin just handed out.
- Invite and ordinary role choices show their plain-language consequences before the mutation is
  submitted; ordinary role changes require explicit confirmation.
- An Admin manages members but NOT owner-only operations (the acceptance headline, enforced per the
  `can` matrix + the pure guards `canManageMemberRole`/`canRemoveMember`):
  - the **Owner** option is absent for everyone (role select and invite-role picker);
  - the **Owner row** shows no ordinary role control or Remove action for anyone;
  - no row carries a transfer-ownership control for anyone (`data-testid="member-make-owner"` is
    absent everywhere); ownership moves only through the ceremony in US-SET-18, which re-reads both
    membership projections afterwards so the former Owner's role badge and affordances reflect the
    demotion.
- Invitation creation explains that CapacityLens sends no email: the administrator must copy and
  send the link. The field label is simply **Email**, with no explanatory helper copy; it remains
  optional in password mode and required in SSO-only mode. Success and recovery instructions remain
  inline with the one-time link.
- Recipients can choose **Sign in** or **Create account** with equally prominent controls. Only the
  selected journey's fields appear. Existing users review and explicitly accept as the signed-in
  identity; changing identity preserves the invitation. New users create their sign-in and accept
  atomically. The company, role consequences and expiry remain fully readable throughout. Addressed
  invitations show a recipient hint containing only the part before `@` followed by `@…`; recipients
  enter the full email address themselves, and the domain stays hidden in the preview.
- New Google or Microsoft identities require an unused invitation addressed to their verified
  email. Microsoft may require a one-time mailbox proof in the same browser before onboarding;
  returning sign-in does not repeat it. Provider sign-in does not silently accept an invitation.
  In company-sign-in-only mode, the recipient must use a configured company provider; password
  and GitHub sessions cannot accept it. Existing accounts connect providers explicitly without
  creating another person or changing their memberships.
- The invite token is shown **once** at creation (`/invite/<token>`), is stored only as a one-way
  hash, and the invites list carries no token. Accepted (used) invites remain listed (marked _used_)
  for admin visibility; an expired, unaccepted link is pruned.
- The server is the backstop regardless of the UI: any generic Owner assignment or Owner invite is
  **400**; touching or removing the Owner outside the ownership-transfer ceremony is **403**;
  revoking another account's invite is a no-op; and reading another
  account's members is **403** (no cross-tenant member leak).
- API routes: `GET /api/accounts/:accountId/members` (returns
  `{members, signInTrackingEnabled}`; each member carries `status` and nullable
  `signInConfirmed`), `PUT …/member-sign-in-tracking {enabled}` (Owner only),
  `PATCH …/members/:userId {role}`, `PATCH …/members/:userId/status {status}`,
  `DELETE …/members/:userId`,
  `GET /api/accounts/:accountId/invites` (no token), `DELETE …/invites/:id`. OFF mode returns empty
  lists and inert mutates.
