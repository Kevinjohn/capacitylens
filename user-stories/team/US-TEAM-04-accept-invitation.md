# US-TEAM-04 — Accept an emailed invitation

As an invited person, I want to accept my email invitation so that I can request access to the company.

**Status:** Current
**Access:** Person with a valid invitation
**Entry:** Invitation email → Accept invitation
**Documentation:** [Join your team](../../docs-src/using/join-your-team.md#accept-an-invitation)
**Source:** [InviteAccept.tsx](../../apps/frontend/src/components/invitations/InviteAccept.tsx)

## Acceptance criteria

- Use the **Name** and **Password** fields in [Create my account from an invitation](../account/US-ACCOUNT-06-sign-up.md).

- The page shows the invited company and role, then **Accept invitation** creates the invited sign-in and membership. The person must still ask for access and receive approval before seeing company data.

## User flow

```mermaid
flowchart TD
    Open["Open the emailed invitation"] --> Review["Review company and offered role"]
    Review --> Details{"Is the invitation valid?"}
    Details -->|"No"| Error["Read the invalid or expired invitation message"]
    Details -->|"Yes"| Form["Enter Name and Password"]
    Form --> Submit["Select Accept invitation"]
    Submit --> SignIn["Continue to the app"]
    SignIn --> Request["Ask for access and wait for approval"]
```

## Code flow

```mermaid
flowchart TD
  page["InviteAccept loads readInvitationPreview for the URL token"] --> inspect["InvitationLinksController.show calls the Kit's non-consuming inspection"]
  inspect -->|Invalid| invalid["Render invalid invitation"]
  inspect -->|Valid| form["Render Name and Password with the invited context"]
  page -->|Preview unavailable| retry["Show unavailable or network error with Go to App"]
  form -->|Valid submit| endpoint["signUpWithInvitation calls InvitationAcceptancesController.store"]
  form -->|Invalid draft| invalidDraft["Show client field error"]
  endpoint --> kit["Validate submitted fields; Account Kit accepts token and creates confirmed identity and invitation evidence"]
  kit -->|Expired or invalid| invalid
  kit -->|EMAIL_IN_USE| signIn["Return to the form with the sign-in message"]
  kit -->|Other known refusal| refusal["Show refusal in the form"]
  kit -->|Company invitation| membership["Access Control creates membership; product callback records audit and revision in the transaction"]
  membership --> session["Try signInWithPassword"]
  kit -->|Bootstrap invitation| session
  session -->|Session created| ok["HTTP 201"]
  session -->|Sign-in failed| accepted["HTTP 202 with signInRequired"]
  kit -->|Committed follow-up failure| accepted
  ok --> browser["Client maps both to signed-up and navigates to the root for a session check"]
  accepted --> browser
  endpoint -->|5xx or no response| uncertain["Remain on the uncertainty screen with Go to App"]
```

**Code references:** [InviteAccept.tsx](../../apps/frontend/src/components/invitations/InviteAccept.tsx#L55) · [InviteAccept.tsx](../../apps/frontend/src/components/invitations/InviteAccept.tsx#L97) · [invitation_links_controller.ts](../../apps/backend/app/controllers/invitation_links_controller.ts#L11) · [invitation_acceptances_controller.ts](../../apps/backend/app/controllers/invitation_acceptances_controller.ts#L22) · [invitationSignUpApi.ts](../../apps/frontend/src/account/invitationSignUpApi.ts#L64) · [account_kit.ts](../../apps/backend/config/account_kit.ts#L72) · [membership_effects.ts](../../apps/backend/app/services/account_kit/membership_effects.ts#L8) · [invitations.spec.ts](../../apps/backend/tests/functional/auth/invitations.spec.ts#L80)
