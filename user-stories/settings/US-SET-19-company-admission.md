# US-SET-19 — Approve company admission

As an Owner or Admin, I want to approve or decline admission so that company access follows our admission rules.

**Status:** Current
**Access:** Owner, Admin; invited person
**Entry:** Team & access → Waiting for approval; admission screen
**Documentation:** [Invite teammates](../../docs-src/admin/invite-teammates.md)
**Source:** [AdmissionRequestsPanel.tsx](../../apps/frontend/src/components/team/AdmissionRequestsPanel.tsx)

## Acceptance criteria

- Invitation acceptance creates membership but does not grant company data before approval. Owner/Admin decisions apply on the person’s next request. See [US-TEAM-05](../team/US-TEAM-05-request-admission.md).

## User flow

```mermaid
flowchart TD
A["A person requests access from the limited access screen"] --> B["Owner or Admin opens Waiting for approval"]
B --> C{"Choose an available decision"}
C -->|approve| D["Person checks access again and joins if eligible"]
C -->|decline pending request| E["Person sees declined access on the next check"]
```

## Code flow

```mermaid
flowchart TD
  team["TeamAccessView mounts Waiting for approval for real Owner or Admin"] --> list["AdmissionRequestsPanel fetches the authorized paged list"]
  list -->|No rows| empty["Show empty state"]
  list -->|Read failed| retry["Show Retry"]
  retry --> list
  list -->|Pending, declined or revoked rows| buttons["Approve any returned row; offer Decline on pending rows"]
  buttons --> submit["teamAccessApi sends selected userId to the approval or rejection controller"]
  submit --> service["decideAdmission calls Account Kit with current actor and target"]
  service -->|Authorized| persist["Persist the decision; the person observes it on a later request"]
  service -->|Returned refusal| error["Show refusal"]
  error --> list
  persist --> list
  submit -->|Transport failure| uncertain["Show decision failure"]
  retained["Separate revocation route"] --> api["Eligible API clients can request revoke through the same service"]
```

See [Request company access and check the decision](../team/US-TEAM-05-request-admission.md#code-flow) for the person’s next session check.

**Code references:** [TeamAccessView.tsx](../../apps/frontend/src/components/team/TeamAccessView.tsx#L196) · [AdmissionRequestsPanel.tsx](../../apps/frontend/src/components/team/AdmissionRequestsPanel.tsx#L50) · [AdmissionRequestsPanel.tsx](../../apps/frontend/src/components/team/AdmissionRequestsPanel.tsx#L74) · [teamAccessApi.ts](../../apps/frontend/src/account/teamAccessApi.ts#L126) · [admission_decisions.ts](../../apps/backend/app/services/admission/admission_decisions.ts#L15) · [admission_rules.ts](../../apps/backend/app/services/account_kit/admission_rules.ts#L41) · [admission_approvals_controller.ts](../../apps/backend/app/controllers/admission_approvals_controller.ts#L4) · [admission_routes.ts](../../apps/backend/start/admission_routes.ts#L45) · [admission.spec.ts](../../apps/backend/tests/functional/auth/admission.spec.ts#L167)
