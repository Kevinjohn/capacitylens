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
  panel["InviteMemberPanel opens Invite someone dialog"] -->|Cancel| close["Close the dialog"]
  panel -->|Submit| validate["useMemberInvites trims and checks the email"]
  validate -->|Invalid| error["Show invite field error"]
  validate -->|Valid| request["teamAccessApi calls InvitationsController.store"]
  request --> auth["Validate request and require current invitation manager"]
  auth -->|Allowed| mail{"Mail configured?"}
  auth -->|Refused| error
  mail -->|No| error
  mail -->|Yes| kit["Account Kit rechecks current transaction authority and saves invitation before mail delivery"]
  kit -->|Refused| error
  kit -->|Saved and emailed| completed["Show emailed notice; clear the email draft"]
  kit -->|Saved but delivery failed| warning["HTTP 202: show warning; clear the email draft"]
  completed --> reload["Reload invitations"]
  warning --> reload
  request -->|Unknown outcome| reconcile["Reconcile directory before inviting again"]
```

**Code references:** [InviteMemberPanel.tsx](../../apps/frontend/src/components/team/InviteMemberPanel.tsx#L35) · [useMemberInvites.ts](../../apps/frontend/src/components/team/useMemberInvites.ts#L31) · [invitations_controller.ts](../../apps/backend/app/controllers/invitations_controller.ts#L19) · [account_kit.ts](../../apps/backend/config/account_kit.ts#L53) · [invitations.spec.ts](../../apps/backend/tests/functional/auth/invitations.spec.ts#L363)
