# US-SET-10 — Member management (Owner/Admin invite / list / role / revoke)

**Area:** Team & access · **Persona:** Studio owner / admin · **Linked E2E:** `e2e/members.auth.spec.ts` → "admin manages members but not owner-only ops; ownership changes only by transfer; no cross-tenant leak"

## Goal

Let an Owner or Admin manage who can access their company from Team & access: see the member list, invite
people (a link, optionally pre-authorised to one email), change a member's role, disable or restore a
member's access, remove a member, and list/revoke outstanding invites. An Admin manages members but
cannot do owner-only operations. Ownership transfer is owner-only and, since #175, has no per-row
control: it is an API operation awaiting its own owner-only section.

## Why

On an auth-enabled, server-backed deploy, access to a company is a real membership (a role per login),
so the people who run a company need a place to grant, adjust, and revoke that access without touching
the database. Team & access is visible to every role so a Viewer/Editor can understand their own
limits; management controls remain Owner/Admin-only. Ownership has one explicit, atomic transfer path,
and the database prevents a second active Owner. Disabling is the reversible middle ground between
"nothing changed" and "removed": a **disabled** or **archived** membership keeps its role and history
but authorizes nothing, because every server-side authorization read narrows on an _active_ row.
Invites reuse the P1.9 single-use link: the secret token is shown once at creation, stored only as a
one-way hash, and never read back, so listing or revoking invites can never leak a live, role-bearing
link.

The **Members management section** is a server + auth-on feature only. With auth off or in the
in-memory demo, **Team & access** still explains the access posture and member/resource distinction,
but no directory or management controls exist.

## How (end-to-end)

**Precondition:** The app runs in its default server mode against a server with
`CAPACITYLENS_AUTH=password`. Same-origin `/api` needs no frontend API setting; set
`VITE_CAPACITYLENS_API` only when the API uses a different origin. Owner A has created a company and
invited Admin B and Editor C (both accepted). Sign in as **B (admin)**, pick the company, dismiss the
intro.

1. Open **Team & access** (sidebar). **Your access** summarises the caller's role in a sentence; the
   full capability tick list is collapsed behind **See full capabilities**
   (`data-testid="capabilities-toggle"`), so the page opens on the member table rather than on
   reference material. Below it sits the **Members** section (`data-testid="members-section"`,
   heading **Members**).
2. The **member list** is a table (`data-testid="members-table"`) with the columns **Name**,
   **Member role**, **Last login** and **Actions**, one row per member
   (`data-testid="member-row"`); B's own row is marked **(you)**. The table lists the active members,
   ordered by join date and then by name; disabled and archived memberships are grouped below it
   behind a collapsed **No longer active (_count_)** disclosure
   (`data-testid="members-inactive-toggle"`) that reveals a second table
   (`data-testid="members-inactive-table"`) whose rows carry a **Disabled**/**Archived** badge. **Last login** is derived from the retained session table, so a
   member with no retained session reads **Unknown** — never "Never", which this read cannot honestly
   distinguish.
3. Each row ends in two controls, both naming their member for screen readers: a pencil
   (`data-testid="member-edit"`) that opens the **Change member role** dialog, and a gear
   (`data-testid="member-menu"`) that opens the member-actions menu. Both are disabled while any
   member mutation is in flight.
4. B clicks **C**'s pencil, chooses Viewer in the dialog's role select
   (`data-testid="member-role-select"`), reads the plain-language summary of what Viewer can and
   cannot do, and clicks **Save role** (`data-testid="member-role-save"`).
5. B opens **C**'s gear menu. It holds **Reset password** (US-SET-13), **Revoke sessions**, **Disable
   user** (`data-testid="member-disable"`), **Archive user** (`data-testid="member-archive"`) and
   **Remove** — each behind an explicit confirmation naming C. Once C is disabled, C's row moves into
   the **No longer active** group and C's menu offers **Restore access**
   (`data-testid="member-restore"`) in place of disable/archive. C stays listed there, so the
   operation is visible and reversible, but every read C attempts against the company is refused by
   the server.
6. In the separate **Invite someone** card, B picks a role (`data-testid="invite-role"`), optionally fills the
   **pre-authorise email** (`data-testid="invite-preauth"`), checks the selected role's visible
   capability summary, and clicks **Create invite**
   (`data-testid="invite-submit"`). The full link `<origin>/invite/<token>` appears **once**
   (`data-testid="invite-link"`) with a visible **Copy** button whose accessible name is
   **Copy invitation link**. That write-once block disappears if the
   matching invite is revoked, or an authoritative refresh reports that it was used or is missing,
   so the UI never offers a dead bearer link.
7. The invites list (`data-testid="invite-row"`) shows the new invite **and** the admin/editor
   invites B and C already accepted — an accepted invite stays listed **marked used** (so an admin can
   confirm it was taken; only an expired, unaccepted link is pruned). B clicks **Revoke**
   (`data-testid="invite-revoke"`) on the newest and its row goes away.
8. B never sees an **Owner** option (neither in a role select nor the invite-role picker), no
   **Transfer ownership** button on any row — since #175 no row offers one to anyone — and owner A's
   row shows B neither a pencil nor a gear (an Admin can't touch an owner). Signed in as A, that same
   row keeps a gear holding only the self-service **Reset password** and **Revoke sessions**: nobody
   can disable an Owner, or themselves. See US-SET-13 for the reset-link flow itself.
9. **Ownership transfer** remains owner-only and atomic, but is currently reached through
   `POST …/transfer-ownership {toUserId}` rather than the member table: it promotes the target to
   **Owner** and steps the caller down to **Admin** in one server call, and the account always keeps
   exactly one Owner. The caller cannot target themselves (400) or a non-member (404). A follow-up
   issue gives it a dedicated owner-only section.

## Acceptance criteria

- **Team & access** renders for every role and distinguishes the in-memory **Demo access** posture
  from a persisted auth-off server's **Open access** posture. The **Members** management section
  renders only in server + auth-on mode for an Owner/Admin; a Viewer/Editor sees their role
  explanation but no member directory or controls.
- The member list is a table of **Name**, **Member role**, **Last login** and **Actions**, with the
  caller's own row marked, ordered by join date and then by name. An unknown last login renders
  **Unknown**, never "Never".
- The main table lists only active members. Disabled and archived memberships appear under a
  **No longer active (_count_)** disclosure that is **collapsed by default**, reports its state
  through `aria-expanded`, badges each row **Disabled** or **Archived**, and is absent entirely when
  no membership is in either state.
- The capability tick list is collapsed by default and toggles from a single control that reports its
  state through `aria-expanded`.
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
    absent everywhere); `POST …/transfer-ownership` stays owner-only, atomically promoting the target
    to Owner and demoting the caller to Admin, and both membership projections are re-read afterwards
    so the caller's role badge and affordances reflect the demotion.
- The invite token is shown **once** at creation (`/invite/<token>`), is stored only as a one-way
  hash, and the invites list carries no token. Accepted (used) invites remain listed (marked _used_)
  for admin visibility; an expired, unaccepted link is pruned.
- The server is the backstop regardless of the UI: any generic Owner assignment or Owner invite is
  **400**; touching or removing the Owner outside transfer is **403**;
  transferring ownership as a non-owner is **403**, to a non-member is **404**, and to a missing/empty
  or self target is **400**; revoking another account's invite is a no-op; and reading another
  account's members is **403** (no cross-tenant member leak).
- API routes: `GET /api/accounts/:accountId/members` (each member carries `status` and a nullable
  `lastLoginAt`), `PATCH …/members/:userId {role}`, `PATCH …/members/:userId/status {status}`,
  `DELETE …/members/:userId`, `POST …/transfer-ownership {toUserId}` (owner-only),
  `GET /api/accounts/:accountId/invites` (no token), `DELETE …/invites/:id`. OFF mode returns empty
  lists and inert mutates.
