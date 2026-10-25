# US-SET-19 — Approve who joins the company

**Area:** Team & access · **Persona:** Company Owner or Admin, and an invited person ·
**Linked E2E:** `e2e/admission.auth.spec.ts`; **Automated coverage:**
`apps/backend/tests/functional/auth/admission.spec.ts`

## Goal

Nobody sees company data until an Owner or Admin has approved them, even after they accept an
invitation.

**Guide:** [Approve new people](../../docs-src/admin/invite-teammates.md#approve-new-people) and
[Join your team](../../docs-src/using/join-your-team.md).

## Why

An invitation link can be forwarded. Approval keeps the decision about who enters the company with
its Owner and Admins.

## How (end-to-end)

**Precondition:** a company with an Owner, and an emailed invitation for a new person.

1. The person opens the invitation link, sees the company and role, enters a name and password and
   selects **Accept invitation**.
2. The person sees the admission screen, selects **Ask for access** and reads that an Owner or
   Admin will approve their access.
3. The Owner opens **Team & access**. Under **Waiting for approval** the request lists the person with the invited role. The
   Owner selects **Approve**, and the request leaves the list.
4. The person selects **Check again** and the app opens with the invited role.

## Acceptance criteria

- Accepting an invitation confirms the address and creates the membership, but company data stays
  refused (403) until approval.
- Only Owners and Admins list and decide requests, and never for someone their role cannot
  administer. Editors and Viewers get 403.
- Rejecting or revoking approval refuses company data on the person's next request.
- When `CAPACITYLENS_ALLOWED_EMAIL_DOMAINS` is set, only those address domains can be admitted.
- An address the company removed cannot rejoin through an invitation.
