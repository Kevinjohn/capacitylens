# US-SET-10 — Member management (Owner/Admin invite / list / role / revoke)

**Area:** Settings · **Persona:** Studio owner / admin · **Linked E2E:** `e2e/members.auth.spec.ts` → "admin manages members but not owner-only ops; owner is last-owner protected; no cross-tenant leak"

## Goal
Let an Owner or Admin manage who can access their company from Settings: see the member list, invite
people (a link, optionally pre-authorised to one email), change a member's role, remove a member, and
list/revoke outstanding invites. An Admin manages members but cannot do owner-only operations.

## Why
On an auth-enabled, server-backed deploy, access to a company is a real membership (a role per login),
so the people who run a company need a place to grant, adjust, and revoke that access without touching
the database. It belongs in Settings (the existing per-company admin surface) and must be invisible to
anyone who can't use it — a Viewer/Editor never sees it. The dangerous operations are owner-only and
last-owner-protected so the account can never be left ownerless or have ownership quietly escalated.
Invites reuse the P1.9 single-use link: the secret token is shown once at creation and never read
back, so listing or revoking invites can never leak a live, role-bearing link.

This is a **server + auth-on** feature only. In the default deploy (auth off) or local mode the
section does not exist.

## How (end-to-end)
**Precondition:** The app runs in server mode (`VITE_CAPACITYLENS_API` set) against a server with
`CAPACITYLENS_AUTH=password`. Owner A has created a company and invited Admin B and Editor C (both
accepted). Sign in as **B (admin)**, pick the company, dismiss the intro.

1. Open **Settings** (sidebar). Below the **Account** section there is a **Members** section
   (`data-testid="members-section"`, heading **Members**).
2. The **member list** shows a row per member (`data-testid="member-row"`): name (email), role and
   status; B's own row is marked **(you)**.
3. B changes **C** from Editor to Viewer using C's role select (`data-testid="member-role-select"`).
4. In the **Invite someone** form, B picks a role (`data-testid="invite-role"`), optionally fills the
   **pre-authorise email** (`data-testid="invite-preauth"`), and clicks **Create invite**
   (`data-testid="invite-submit"`). The full link `<origin>/invite/<token>` appears **once**
   (`data-testid="invite-link"`) with a **Copy** button.
5. The new invite shows under **Outstanding invites** (`data-testid="invite-row"`); B clicks
   **Revoke** (`data-testid="invite-revoke"`) and the row goes away.
6. B never sees an **owner** option (neither in a role select nor the invite-role picker), and owner
   A's row shows **no** role control and **no** Remove (an Admin can't touch an owner).

## Acceptance criteria
- The **Members** section renders ONLY in server + auth-on mode, and only for an Owner/Admin: a
  Viewer/Editor/non-member receives a **403** on the member read and the section renders **nothing**.
  In auth off or local mode the section is **absent**.
- The member list shows name/email/role/status per member, with the caller's own row marked.
- An Admin manages members but NOT owner-only operations (the acceptance headline, enforced per the
  `can` matrix + the pure guards `canManageMemberRole`/`canRemoveMember`):
  - the **owner** option is hidden for an Admin (role select and invite-role picker);
  - an **owner row** shows no role control and no Remove for an Admin;
  - the **sole owner** is protected — its role select is disabled, Remove is hidden, and
    *"Sole owner — protected"* is shown (the account must keep ≥ 1 owner).
- The invite token is shown **once** at creation (`/invite/<token>`); the outstanding-invites list
  carries no token.
- The server is the backstop regardless of the UI: an Admin granting owner, touching an owner, or
  demoting/removing the last owner is **403**; creating an `owner` invite as an Admin is **403**;
  revoking another account's invite is a no-op; and reading another account's members is **403** (no
  cross-tenant member leak).
- API routes: `GET /api/accounts/:accountId/members`, `PATCH …/members/:userId {role}`,
  `DELETE …/members/:userId`, `GET /api/accounts/:accountId/invites` (no token),
  `DELETE …/invites/:id`. OFF mode returns empty lists and inert mutates.
