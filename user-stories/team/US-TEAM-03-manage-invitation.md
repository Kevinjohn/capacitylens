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
  row["InviteMemberPanel renders outstanding invitations"] -->|Resend, including expired row| resend["useMemberInvites calls InvitationDeliveriesController.store"]
  resend --> check["Require invitation manager and configured mail"]
  check -->|Refused| error["Show action error"]
  check -->|Allowed| replace["Kit invalidates the prior link by replacing the token, then attempts delivery"]
  replace -->|Emailed| sent["Show resend notice"]
  replace -->|Saved with failed delivery| warned["Show saved-but-not-emailed warning"]
  sent --> list["Reload invitations"]
  warned --> list
  resend -->|Unknown or refused result| error
  row -->|Revoke, unexpired row| revoke["useMemberInvites calls InvitationsController.destroy"]
  revoke --> kit["Check current manager; Account Kit revokes invitation"]
  kit -->|Confirmed| list
  kit -->|Refused| error
  revoke -->|Unknown| reconcile["Reconcile directory before another attempt"]
```

**Code references:** [InviteMemberPanel.tsx](../../apps/frontend/src/components/team/InviteMemberPanel.tsx#L141) · [InviteMemberPanel.tsx](../../apps/frontend/src/components/team/InviteMemberPanel.tsx#L178) · [useMemberInvites.ts](../../apps/frontend/src/components/team/useMemberInvites.ts#L95) · [useMemberInvites.ts](../../apps/frontend/src/components/team/useMemberInvites.ts#L137) · [invitation_deliveries_controller.ts](../../apps/backend/app/controllers/invitation_deliveries_controller.ts#L15) · [invitations_controller.ts](../../apps/backend/app/controllers/invitations_controller.ts#L64) · [invitations.spec.ts](../../apps/backend/tests/functional/auth/invitations.spec.ts#L310)
