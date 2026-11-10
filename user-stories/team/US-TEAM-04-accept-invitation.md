# US-TEAM-04 — Accept an emailed invitation

As an invited person, I want to accept my email invitation so that I can request access to the company.

**Status:** Current
**Access:** Person with a valid invitation
**Entry:** Invitation email → Accept invitation
**Documentation:** [Join your team](../../docs-src/using/join-your-team.md#accept-an-invitation)
**Source:** [InviteAccept.tsx](../../apps/frontend/src/components/invites/InviteAccept.tsx)

## Acceptance criteria

- Use the **Name** and **Password** fields in [Create my account from an invitation](../account/US-ACCOUNT-06-register.md).

- The page shows the invited company and role, then **Accept invitation** creates the invited sign-in and membership. The person must still ask for access and receive approval before seeing company data.
