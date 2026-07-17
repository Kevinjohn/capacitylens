# US-SET-10 — Member management (Owner/Admin invite / list / role / revoke)

**Area:** Team & access · **Persona:** Studio owner / admin · **Linked E2E:** `e2e/members.auth.spec.ts` → "admin manages members but not owner-only ops; ownership changes only by transfer; no cross-tenant leak"

## Goal
Let an Owner or Admin manage who can access their company from Team & access: see the member list, invite
people (a link, optionally pre-authorised to one email), change a member's role, remove a member, and
list/revoke outstanding invites. An Owner can additionally **transfer ownership** to another member
(handing the account over). An Admin manages members but cannot do owner-only operations.

## Why
On an auth-enabled, server-backed deploy, access to a company is a real membership (a role per login),
so the people who run a company need a place to grant, adjust, and revoke that access without touching
the database. Team & access is visible to every role so a Viewer/Editor can understand their own
limits; management controls remain Owner/Admin-only. Ownership has one explicit, atomic transfer path,
and the database prevents a second active Owner.
Invites reuse the P1.9 single-use link: the secret token is shown once at creation, stored only as a
one-way hash, and never read back, so listing or revoking invites can never leak a live, role-bearing
link.

The **Members management section** is a server + auth-on feature only. With auth off or in the
in-memory demo, **Team & access** still explains the access posture and member/resource distinction,
but no directory or management controls exist.

## How (end-to-end)
**Precondition:** The app runs in server mode (`VITE_CAPACITYLENS_API` set) against a server with
`CAPACITYLENS_AUTH=password`. Owner A has created a company and invited Admin B and Editor C (both
accepted). Sign in as **B (admin)**, pick the company, dismiss the intro.

1. Open **Team & access** (sidebar). The page explains the caller's role and contains a **Members** section
   (`data-testid="members-section"`, heading **Members**).
2. The **member list** shows a row per member (`data-testid="member-row"`): name (email), role and
   status; B's own row is marked **(you)**.
3. B chooses Viewer in **C**'s role select (`data-testid="member-role-select"`). A confirmation
   names C, explains Viewer access, and sends the change only after B clicks **Change role**.
4. In the **Invite someone** form, B picks a role (`data-testid="invite-role"`), optionally fills the
   **pre-authorise email** (`data-testid="invite-preauth"`), checks the selected role's visible
   capability summary, and clicks **Create invite**
   (`data-testid="invite-submit"`). The full link `<origin>/invite/<token>` appears **once**
   (`data-testid="invite-link"`) with a **Copy** button. That write-once block disappears if the
   matching invite is revoked, or an authoritative refresh reports that it was used or is missing,
   so the UI never offers a dead bearer link.
5. The invites list (`data-testid="invite-row"`) shows the new invite **and** the admin/editor
   invites B and C already accepted — an accepted invite stays listed **marked used** (so an admin can
   confirm it was taken; only an expired, unaccepted link is pruned). B clicks **Revoke**
   (`data-testid="invite-revoke"`) on the newest and its row goes away.
6. B never sees an **Owner** option (neither in a role select nor the invite-role picker), no
   **Transfer ownership** button on any row (transfer is owner-only), and owner A's row shows **no**
   role control, **no** Remove and **no** Reset password (an Admin can't touch an owner — see
   US-SET-13 for the reset-link flow itself).
7. **As A (owner)** — sign in as A (or drive the API): every other, non-owner member's row shows a
   **Transfer ownership** button (`data-testid="member-make-owner"`). After explicit confirmation,
   clicking it on **C** promotes C to **Owner** and steps A down to **Admin** in one atomic server
   call; the account always keeps exactly one Owner. Without a reload, A's sidebar and **Your
   access** panel change to Admin and the Owner-only transfer actions disappear. A cannot target
   themselves (400) or a non-member (404).

## Acceptance criteria
- **Team & access** renders for every role and distinguishes the in-memory **Demo access** posture
  from a persisted auth-off server's **Open access** posture. The **Members** management section
  renders only in server + auth-on mode for an Owner/Admin; a Viewer/Editor sees their role
  explanation but no member directory or controls.
- The member list shows name/email/role/status per member, with the caller's own row marked.
- Invite and ordinary role choices show their plain-language consequences before the mutation is
  submitted; ordinary role changes require explicit confirmation.
- An Admin manages members but NOT owner-only operations (the acceptance headline, enforced per the
  `can` matrix + the pure guards `canManageMemberRole`/`canRemoveMember`):
  - the **Owner** option is absent for everyone (role select and invite-role picker);
  - the **Owner row** shows no ordinary role control or Remove action for anyone;
  - **Transfer ownership** (`data-testid="member-make-owner"`) is shown to an Owner on every other, non-owner
    member's row and to nobody else; it POSTs `transfer-ownership`, atomically promoting the target to
    Owner and demoting the caller to Admin after explicit confirmation. The client then invalidates
    and refetches both membership projections, so the caller's role badge, capability summary and
    affordances update immediately without a reload or account switch.
- The invite token is shown **once** at creation (`/invite/<token>`), is stored only as a one-way
  hash, and the invites list carries no token. Accepted (used) invites remain listed (marked *used*)
  for admin visibility; an expired, unaccepted link is pruned.
- The server is the backstop regardless of the UI: any generic Owner assignment or Owner invite is
  **400**; touching or removing the Owner outside transfer is **403**;
  transferring ownership as a non-owner is **403**, to a non-member is **404**, and to a missing/empty
  or self target is **400**; revoking another account's invite is a no-op; and reading another
  account's members is **403** (no cross-tenant member leak).
- API routes: `GET /api/accounts/:accountId/members`, `PATCH …/members/:userId {role}`,
  `DELETE …/members/:userId`, `POST …/transfer-ownership {toUserId}` (owner-only),
  `GET /api/accounts/:accountId/invites` (no token), `DELETE …/invites/:id`. OFF mode returns empty
  lists and inert mutates.
