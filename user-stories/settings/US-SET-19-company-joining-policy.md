# US-SET-19 — Approve company admission

As an Owner or Admin, I want to approve or decline admission so that company access follows our admission policy.

**Status:** Current
**Access:** Owner, Admin; invited person
**Entry:** Team & access → Waiting for approval; admission screen
**Documentation:** [Invite teammates](../../docs-src/admin/invite-teammates.md)
**Source:** [AdmissionRequestsPanel.tsx](../../apps/frontend/src/components/team/AdmissionRequestsPanel.tsx)

## Acceptance criteria

- Invitation acceptance creates membership but does not grant company data before approval. Owner/Admin decisions apply on the person’s next request. See [US-TEAM-05](../team/US-TEAM-05-request-admission.md).
