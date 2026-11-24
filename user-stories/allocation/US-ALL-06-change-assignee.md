# US-ALL-06 — Change an allocation's assignee

As an Editor, I want to change an allocation’s assignee so that work can move to the resource who will do it.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [AllocationDialog.tsx](../../apps/frontend/src/components/scheduler/AllocationDialog.tsx)

## Acceptance criteria

| Field    | Control | Required/default/conditions                                                                                                 |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| Assignee | Select  | Required; prefilled with the current resource. The other edit fields remain as described in [US-ALL-02](US-ALL-02-edit.md). |

## User flow

```mermaid
flowchart TD
  N1["Open allocation"]
  N2["choose another assignee"]
  N3["Save"]
  N4["booking moves to that resource"]
  B1["Invalid placement or save error: form stays open with error"]
  B2["Cancel: original assignee remains"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
  N3 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  Edit["AllocationTargetFields renders edit-only Assignee choices from useAllocationTargetState"] --> Change["changeAssignee updates the form draft"]
  Change -->|bound placeholder| Reset["Set bound project and clear Activity"]
  Reset --> Submit["createAllocationIntents checks opening basis, parses and preflights new assignment"]
  Change -->|other resource| Submit
  Edit -->|Cancel| Closed["Close form without sending draft"]
  Submit -->|stale or invalid| Field["Show form or field error"]
  Submit --> Update["updateAllocation → buildAllocationUpdate"]
  Update -->|unchanged| Closed
  Update -->|changed| Commit["commit checks live write access and revision before allocation.update"]
  Commit --> Write["writeEntity checks assignment; changed resource enforces availability and applicable working day"]
  Write -->|committed and reconciled| Saved["Close after accepted receipt; show any advisory"]
  Commit -->|refused| Refusal["Form error; stale refusal refreshes"]
  Commit -->|lost or invalid reply| Unknown["Canonical read may already show new assignee; no replay"]
```

Ignore working days can bypass the working-day check for a reassignment. Availability dates, time off and applicable closures still constrain the new start. The pointer gesture uses [allocation.reassign](../scheduler/US-SCH-06-reassign-drag.md).

**Code references:**

- [AllocationTargetFields.tsx](../../apps/frontend/src/components/scheduler/AllocationTargetFields.tsx#L26)
- [useAllocationTargetState.ts](../../apps/frontend/src/components/scheduler/useAllocationTargetState.ts#L54)
- [useAllocationTargetState.ts](../../apps/frontend/src/components/scheduler/useAllocationTargetState.ts#L279)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts#L142)
- [planningIntents.ts](../../apps/frontend/src/data/planning/planningIntents.ts#L177)
- [entity_write_service.ts](../../apps/backend/app/services/planning/entity_write_service.ts#L134)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L9)
- [planning_service.ts](../../apps/backend/app/services/planning_service.ts#L222)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
- [allocation_start_availability.spec.ts](../../apps/backend/tests/functional/planning/allocation_start_availability.spec.ts#L95)
