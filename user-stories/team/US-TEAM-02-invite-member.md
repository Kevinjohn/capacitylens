# US-TEAM-02 — Invite a teammate

As an Owner or Admin, I want to email a teammate an invitation with a role so that they can request company access.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Team & access → Invite someone
**Documentation:** [Invite teammates](../../docs-src/admin/invite-teammates.md)
**Source:** [InviteMemberPanel.tsx](../../apps/frontend/src/components/team/InviteMemberPanel.tsx)

## Acceptance criteria

| Field | Control     | Required/default/conditions                                                     |
| ----- | ----------- | ------------------------------------------------------------------------------- |
| Role  | Select      | Required; defaults to Editor; Admin, Editor or Viewer are available, not Owner. |
| Email | Email input | Required; invitee's address.                                                    |

- The **Invite someone** section is its heading, the **Invite someone** button and any outstanding invitations; it has no intro paragraph. The explanation of email delivery and approval is the description of the invitation dialog.
- **Create invite** emails the invitation; the app does not display the invitation link. Missing mail configuration prevents creation. If delivery fails after the invitation was saved, the page explains that it was saved but not emailed and it can be resent.

## User flow

```mermaid
flowchart TD
    Open["Owner or Admin opens Team & access"] --> Invite["Select Invite someone"]
    Invite --> Details["Read the dialog description, choose role and enter email"]
    Details -->|"Cancel"| Back["Return to Team & access"]
    Details --> Submit["Select Create invite"]
    Submit --> Mail{"Can the invitation email be sent?"}
    Mail -->|"Mail is not configured"| Blocked["No invitation is created; read the mail setup message"]
    Mail -->|"Email succeeds"| Sent["Invitation emailed notice appears"]
    Mail -->|"Delivery fails after saving"| Saved["Saved but not emailed notice appears"]
    Saved --> Later["Resend the invitation later"]
```

## Code flow

```mermaid
flowchart TD
    Panel["InviteMemberPanel opens Modal with settings_invite_intro description, then submit"] --> Hook["useMemberInvites submitInvite validates email"]
    Hook --> Client["teamAccessApi.createInvitation → invitationRequests.createInvitation"]
    Client --> Route["api.invites.create → InvitationsController.create"]
    Route --> MailConfig{"CAPACITYLENS_MAIL_HOST configured?"}
    MailConfig -- "No" --> Refused["MAIL_UNAVAILABLE; UI shows failure"]
    MailConfig -- "Yes" --> Kit["Account Kit invitations.send stores invitation and sends mail"]
    Kit -->|"Created and emailed"| Saved["UI shows emailed notice and reloads invites"]
    Kit -->|"Committed, delivery failed"| Stored["202 emailed=false; UI shows saved but not emailed"]
    Stored --> Resend["Outstanding invites exposes Resend"]
```

**Code references:** [InviteMemberPanel.tsx](../../apps/frontend/src/components/team/InviteMemberPanel.tsx), [useMemberInvites.ts](../../apps/frontend/src/components/team/useMemberInvites.ts), [teamAccessApi.ts](../../apps/frontend/src/account/teamAccessApi.ts), [invitationRequests.ts](../../apps/frontend/src/account/invitationRequests.ts), [admission_routes.ts](../../apps/backend/start/admission_routes.ts), [invitations_controller.ts](../../apps/backend/app/controllers/invitations_controller.ts)
