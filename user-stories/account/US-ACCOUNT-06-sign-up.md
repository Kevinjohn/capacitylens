# US-ACCOUNT-06 — Create my account from an invitation

As an invited person, I want to create my sign-in from the emailed invitation so that I can begin joining the company.

**Status:** Current
**Access:** Person with a valid invitation for an address that does not already have an account.
**Entry:** Emailed invitation link → Accept invitation
**Documentation:** [Join your team](../../docs-src/using/join-your-team.md)
**Source:** [InviteAccept.tsx](../../apps/frontend/src/components/invitations/InviteAccept.tsx); [en.json](../../apps/frontend/messages/en.json)

## Acceptance criteria

| Field    | Control        | Required/default/conditions                                 |
| -------- | -------------- | ----------------------------------------------------------- |
| Name     | Text input     | Required; surrounding whitespace is trimmed when submitted. |
| Password | Password input | Required; 15–128 characters.                                |

- The invitation page shows the invited email, company and proposed role as context; the email is fixed by the invitation.
- **Accept invitation** creates the account from those details. An already-registered email is directed to sign in; an invalid or expired invitation directs the person to ask for a new one. A company invitee continues to request access and await approval before seeing company data; the bootstrap invitation proceeds to first-company setup.

## User flow

```mermaid
flowchart TD
  open["Open emailed invitation"] --> preview["Check invited email, company and role"]
  preview --> form["Enter Name and Password → Accept invitation"]
  form --> company["Company invite: request access and wait for approval"]
  form --> bootstrap["Setup invitation: continue to first-company setup"]
  open --> invalid["Invalid invitation: ask for a new invite"]
  form --> existing["Address already registered: sign in"]
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

The automatic sign-in joins [Enter the persisted application](../navigation/US-NAV-10-sign-in-screen.md#code-flow) at `signInWithPassword`.

**Code references:** [InviteAccept.tsx](../../apps/frontend/src/components/invitations/InviteAccept.tsx#L55) · [InviteAccept.tsx](../../apps/frontend/src/components/invitations/InviteAccept.tsx#L97) · [invitation_links_controller.ts](../../apps/backend/app/controllers/invitation_links_controller.ts#L11) · [invitation_acceptances_controller.ts](../../apps/backend/app/controllers/invitation_acceptances_controller.ts#L22) · [invitationSignUpApi.ts](../../apps/frontend/src/account/invitationSignUpApi.ts#L64) · [package_callbacks_provider.ts](../../apps/backend/providers/package_callbacks_provider.ts#L31) · [membership_effect_service.ts](../../apps/backend/app/services/account_kit/membership_effect_service.ts#L16) · [invitations.spec.ts](../../apps/backend/tests/functional/auth/invitations.spec.ts#L269)
