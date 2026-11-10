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
    Invite["InviteAccept reads token from /invite/:token"] --> Preview["accountClient.previewInvitation"]
    Preview --> PreviewRoute["api.invites.preview → InvitationsController.preview"]
    PreviewRoute --> KitInspect["Account Kit invitations.inspect returns offered email and role"]
    KitInspect --> Form["InviteAccept renders Name and Password fields"]
    Form --> Submit["signupWithInvitation → InvitationsController.signUp"]
    Submit --> Accept["Account Kit invitations.accept creates invited identity and membership"]
    Accept --> SignIn["signInWithPassword or sign-in-required response"]
    SignIn --> Reload["InviteAccept reloads app; AuthProvider resolves limited admission screen"]
    PreviewRoute -. "Invalid or expired token" .-> Error["InviteAccept shows invitation error"]
```

**Code references:** [InviteAccept.tsx](../../apps/frontend/src/components/invites/InviteAccept.tsx), [accountClient.ts](../../apps/frontend/src/account/accountClient.ts), [admission_routes.ts](../../apps/backend/start/admission_routes.ts), [invitations_controller.ts](../../apps/backend/app/controllers/invitations_controller.ts), [AuthProvider.tsx](../../apps/frontend/src/auth/AuthProvider.tsx), [AccessScreens.tsx](../../apps/frontend/src/auth/AccessScreens.tsx)
