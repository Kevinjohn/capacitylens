# US-SET-19 — Decide who can join the company

**Area:** Team & access · **Persona:** Company Owner, Admin, and prospective member ·
**Automated coverage:** `JoiningPolicySection.test.tsx`, `joiningAdmission.test.ts`,
`joiningProofRoutes.test.ts`, and Google provider admission and joining tests

## Goal

Let the Owner choose how new people join this company, while Admins can see the current choice and
prospective members have a company-specific path to request access. The policy never grants access
to somebody whose access was explicitly disabled.

**Guide:** [Invite teammates](../../docs-src/admin/invite-teammates.md#review-who-can-join) and
[Join your team](../../docs-src/using/join-your-team.md), and
[Company sign-in](../../docs-src/company-login/index.md#invitations-and-the-first-owner).

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
3. Open `/join/:accountId` as a prospective member. The page names the company. An existing Google
   identity or password account signs in, then chooses **Join company** to finish. An existing
   password identity without current trusted email proof can verify its address by an emailed link
   to join through an open or approved-domain policy when email delivery is enabled. A new Google
   identity needs an unused invitation addressed to its verified Google email; an open or
   domain-only policy does not create a new sign-in identity.
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
- The joining page offers Google and, when enabled, the existing password path. A Google callback
  does not itself create company membership. The person must explicitly choose **Join company**;
  completion rechecks the live company policy, verified address, invitation where required, access
  restrictions and authenticated identity.
- Open and domain policy joining accepts an existing password or Google identity with current
  durable address proof; company joining does not create a new provider identity. A new Google
  identity can be admitted through an unused addressed invitation, but invitation acceptance is a
  separate explicit action. An identity without current email proof must establish it before
  joining under an open or domain policy.
- A policy change, revoked or consumed invitation, changed address, disabled access, or lost
  authentication before completion refuses admission without creating a membership. Concurrent
  completions grant at most one membership and consume an invitation at most once.
