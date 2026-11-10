# US-TEAM-03 — Resend or revoke an invitation

As an Owner or Admin, I want to resend or revoke an outstanding invitation so that I can keep unaccepted access offers current.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Team & access → Outstanding invites
**Documentation:** [Invite teammates](../../docs-src/admin/invite-teammates.md#revoke-an-invitation)
**Source:** [InviteMemberPanel.tsx](../../apps/frontend/src/components/team/InviteMemberPanel.tsx)

## Acceptance criteria

- Each invitation shows its email, offered role and expiry date or expired status.
- **Resend** emails a fresh link and replaces the previous invitation.
- **Revoke** cancels an unexpired invitation; expired invitations do not show the Revoke control.
