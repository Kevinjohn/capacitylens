# US-TEAM-03 — Resend or revoke an invitation

As an Owner or Admin, I want to resend or revoke an outstanding invitation so that I can keep unaccepted access offers current.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Team & access → Outstanding invites
**Documentation:** [Invite teammates](../../docs-src/admin/invite-teammates.md#revoke-an-invitation)
**Source:** [InviteMemberPanel.tsx](../../apps/frontend/src/components/team/InviteMemberPanel.tsx)

## Acceptance criteria

- Each invitation shows its email, offered role and expiry date or expired status.
- **Resend** emails a fresh link that replaces the previous one; it is refused when email delivery is not configured.
- **Revoke** cancels an unexpired invitation; expired invitations do not show the Revoke control.

## User flow

```mermaid
flowchart TD
    Open["Open Outstanding invites"] --> Row["Choose an invitation"]
    Row --> Action{"Choose an available action"}
    Action -->|"Resend"| Resend["A fresh invitation email replaces the old link"]
    Resend --> Delivery{"Was the email delivered?"}
    Delivery -->|"Yes"| Notice["Read the sent notice"]
    Delivery -->|"No"| Error["Read the delivery error or saved-but-not-emailed notice"]
    Action -->|"Revoke, when unexpired"| Revoke["Invitation is cancelled and removed from the list"]
```

## Code flow

```mermaid
flowchart TD
    Row["InviteMemberPanel renders outstanding invite row"] --> Action{"Resend or Revoke?"}
    Action -->|"Resend"| ResendHook["useMemberInvites resendInvite"]
    ResendHook --> ResendClient["teamAccessClient.resendInvitation → accountClient.resendInvitation"]
    ResendClient --> ResendRoute["api.invites.resend → InvitationsController.resend"]
    ResendRoute --> KitResend["Account Kit resend replaces invitation link and emails it"]
    KitResend --> Reload["reloadInvites refreshes the directory; UI shows outcome"]
    Action -->|"Revoke"| RevokeHook["useMemberInvites revokeInvite"]
    RevokeHook --> RevokeClient["teamAccessClient.revokeInvitation → accountClient.revokeInvitation"]
    RevokeClient --> RevokeRoute["api.invites.revoke → InvitationsController.revoke"]
    RevokeRoute --> KitRevoke["Account Kit revokes the invitation"]
    KitRevoke --> Reload
    ResendRoute -. "Mail unavailable or delivery failure is shown" .-> Error["Resend notice or error"]
```

**Code references:** [InviteMemberPanel.tsx](../../apps/frontend/src/components/team/InviteMemberPanel.tsx), [useMemberInvites.ts](../../apps/frontend/src/components/team/useMemberInvites.ts), [teamAccessClient.ts](../../apps/frontend/src/account/teamAccessClient.ts), [accountClient.ts](../../apps/frontend/src/account/accountClient.ts), [admission_routes.ts](../../apps/backend/start/admission_routes.ts), [invitations_controller.ts](../../apps/backend/app/controllers/invitations_controller.ts)
