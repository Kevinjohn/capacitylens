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
  team["TeamAccessView resolves access for the current identity and company"] -->|members:manage| section["MembersSection requests its authorized directory"]
  team -->|Pending or restricted| hidden["Management actions stay unavailable"]
  section -->|Read failed| retry["Show directory error and Retry"]
  retry --> section
  section -->|Read accepted| rows["Expose Members and Invite someone; bind actions to the loaded rows"]
  rows --> boundary["Delegate writes and reconciliation to each Team action"]
  team -->|Real Owner or Admin| admission["AdmissionRequestsPanel loads Waiting for approval independently"]
  admission -->|No requests| empty["Show its empty state"]
  admission -->|Read failed| admissionError["Show its own Retry"]
  admissionError --> admission
  admission -->|Rows| decisions["Expose Approve, and Decline for pending rows"]
```

See the [Team actions](../team/US-TEAM-01-check-access.md#code-flow) and [admission decisions](US-SET-19-company-admission.md#code-flow) for write boundaries.

**Code references:** [TeamAccessView.tsx](../../apps/frontend/src/components/team/TeamAccessView.tsx#L131) · [TeamAccessView.tsx](../../apps/frontend/src/components/team/TeamAccessView.tsx#L188) · [MembersSection.tsx](../../apps/frontend/src/components/team/MembersSection.tsx#L28) · [MembersSection.tsx](../../apps/frontend/src/components/team/MembersSection.tsx#L260) · [AdmissionRequestsPanel.tsx](../../apps/frontend/src/components/team/AdmissionRequestsPanel.tsx#L74)
