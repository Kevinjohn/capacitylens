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
  submit --> service["AdmissionDecisionService.decide validates userId, reads the signed-in account from web and calls AccountAdmission"]
  service --> policy["Registered admissionAuthorize callback checks live invitation-management permission and whether the actor can manage an existing target member"]
  policy -->|Authorized| persist["Persist the decision; the person observes it on a later request"]
  service -->|Returned refusal| error["Show refusal"]
  policy -->|Refused| error
  error --> list
  persist --> list
  submit -->|Transport failure| uncertain["Show decision failure"]
  retained["Separate revocation route"] --> api["AdmissionRevocationsController calls AdmissionDecisionService.decide with revoke"]
```

See [Request company access and check the decision](../team/US-TEAM-05-request-admission.md#code-flow) for the person’s next session check.

**Code references:** [TeamAccessView.tsx](../../apps/frontend/src/components/team/TeamAccessView.tsx#L196) · [AdmissionRequestsPanel.tsx](../../apps/frontend/src/components/team/AdmissionRequestsPanel.tsx#L51) · [AdmissionRequestsPanel.tsx](../../apps/frontend/src/components/team/AdmissionRequestsPanel.tsx#L75) · [teamAccessApi.ts](../../apps/frontend/src/account/teamAccessApi.ts#L126) · [admission_decision_service.ts](../../apps/backend/app/services/admission/admission_decision_service.ts#L21) · [package_callbacks_provider.ts](../../apps/backend/providers/package_callbacks_provider.ts#L51) · [admission_rule_service.ts](../../apps/backend/app/services/account_kit/admission_rule_service.ts#L60) · [admission_approvals_controller.ts](../../apps/backend/app/controllers/admission_approvals_controller.ts#L18) · [admission.ts](../../apps/backend/start/routes/admission.ts#L40) · [admission.spec.ts](../../apps/backend/tests/functional/auth/admission.spec.ts#L167)
