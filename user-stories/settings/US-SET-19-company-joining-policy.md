# US-SET-19 — Decide who can join the company

**Area:** Team & access · **Persona:** Company Owner, Admin, and prospective member ·
**Automated coverage:** `JoiningPolicySection.test.tsx`, `joiningAdmission.test.ts`,
`joiningProofRoutes.test.ts`, `joiningProviderRoutes.test.ts`, and `microsoftProof.test.ts`

## Goal

Let the Owner choose how new people join this company, while Admins can see the current choice and
prospective members have a company-specific path to request access. The policy never grants access
to somebody whose access was explicitly disabled.

**Guide:** [Invite teammates](../../docs-src/admin/invite-teammates.md#review-who-can-join) and
[Join your team](../../docs-src/using/join-your-team.md).

## Why

Some agencies need invitations for everyone, some welcome anyone with a verified address, and
others want staff from approved domains to join without an invitation while still inviting
freelancers. The company must make that choice explicitly; a generic account sign-in does not
establish company membership.

## How (end-to-end)

**Precondition:** A server-backed company with authentication enabled, an Owner and an Admin.

1. As Owner, open **Team & access** and read **Who can join**. Select **Invitation only**,
   **Open registration**, **Approved domains**, or **Approved domains or invitation**. For a
   domain policy, enter one or more exact domains, one per line, then save. Invalid entries receive
   an inline explanation and cannot be saved.
2. As Admin, open the same page. Read the policy and approved domains, with guidance to speak to
   the Owner about changes. No editing controls appear. Either Owner or Admin can copy and share
   this company's **Joining link** from the section.
3. Open `/join/:accountId` as a prospective member. The page names the company. Choose
   an eligible provider, or sign in with an existing password account and complete any required
   second factor. Choose **Join company** to finish. An existing password identity without
   current trusted email proof is guided to a verified provider or an addressed invitation.
4. Check the company list after joining. The new membership is Viewer unless an addressed,
   unconsumed invitation grants another role. An existing active membership keeps its current role.

## Acceptance criteria

- The Owner alone changes the company policy. Admins can read it. **Invitation only** remains the
  default for existing companies until the Owner chooses otherwise.
- **Approved domains** admits only exact verified mailbox domains. **Approved domains or invitation**
  also admits a recipient of an addressed invitation, including a freelancer outside those domains.
  **Open registration** admits a verified address without an invitation. Invitation-only requires
  an addressed invitation. Domain-only rejects an outside-domain invitation both when issued and
  when accepted.
- All four policies work with eligible hosted company providers. Company-sign-in-only excludes
  passwords and experimental GitHub. A new credential or provider identity alone grants no company
  membership; joining requires the company-bound completion step.
- Open and domain policy joining accepts an existing identity with durable address proof;
  it does not create a new password credential. An addressed invitation can still create a
  password identity where the current policy permits. A returning verified provider identity
  may use its durable address proof; an identity without proof must establish it before joining.
- A policy change, revoked or consumed invitation, changed address, disabled access, or lost
  authentication before completion refuses admission without creating a membership. Concurrent
  completions grant at most one membership and consume an invitation at most once.
