# US-SET-10 — Manage members and invitations

As an Owner or Admin, I want to manage member access and invitations so that only approved teammates can use the company.

**Status:** Current — use US-TEAM stories for individual actions.
**Access:** Owner, Admin
**Entry:** Team & access → Members
**Documentation:** [Invite teammates](../../docs-src/admin/invite-teammates.md)
**Source:** [MembersSection.tsx](../../apps/frontend/src/components/team/MembersSection.tsx)

## Acceptance criteria

- Owner/Admin entry leads to member and invitation actions; see [US-TEAM-02](../team/US-TEAM-02-invite-member.md) through [US-TEAM-07](../team/US-TEAM-07-link-resource.md).
- The **Members** heading has no intro line. The **Invite someone** section has no intro paragraph; its explanation is the invitation dialog description. **Waiting for approval** explains approval only while a request is listed; otherwise it shows "Nobody is waiting for approval."

## User flow

```mermaid
flowchart TD
A["Open Team & access as an Owner or Admin"] --> B{"Choose an eligible access action"}
B -->|invitation| C["Create, resend or revoke an invitation"]
B -->|membership| D["Change role, suspend or restore membership"]
B -->|schedule link| E["Link, change or remove the person's schedule link"]
```

## Code flow

```mermaid
flowchart TD
  team["TeamAccessView renders MembersSection for managers"] --> section["MembersSection delegates invite and member row controls"]
  team --> approval["AdmissionRequestsPanel shows its explanation only when requests are listed"]
  section --> invite["InviteMemberPanel calls invitation controller actions"]
  section --> member["Member row actions call teamAccessApi membership methods"]
  member --> list["MembersSection refreshes directory projection"]
```

**Code references:** [TeamAccessView.tsx](../../apps/frontend/src/components/team/TeamAccessView.tsx), [MembersSection.tsx](../../apps/frontend/src/components/team/MembersSection.tsx), [InviteMemberPanel.tsx](../../apps/frontend/src/components/team/InviteMemberPanel.tsx), [AdmissionRequestsPanel.tsx](../../apps/frontend/src/components/team/AdmissionRequestsPanel.tsx), [teamAccessApi.ts](../../apps/frontend/src/account/teamAccessApi.ts)
