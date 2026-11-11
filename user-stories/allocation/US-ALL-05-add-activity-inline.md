# US-ALL-05 — Add a new activity inline from the modal

As an Editor, I want to add an activity from the allocation form so that I can assign new work without leaving the Schedule.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Schedule (`/`)
**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)
**Source:** [AllocationTargetFields.tsx](../../apps/frontend/src/components/scheduler/AllocationTargetFields.tsx), [AllocationScheduleFields.tsx](../../apps/frontend/src/components/scheduler/AllocationScheduleFields.tsx)

## Acceptance criteria

| Field             | Control    | Required/default/conditions                                                                    |
| ----------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| New activity name | Text input | Required to add an activity; available only when the company enables inline activity creation. |

- **Add activity** (or Enter in the field) creates an activity matching the selected Project: Internal creates an internal activity, No specific project an all-projects activity, and a project a project-specific activity. The new activity is selected in the Activity control; the allocation is saved only by **Save**.

## User flow

```mermaid
flowchart TD
  N1["In allocation form choose project scope"]
  N2["enter activity name"]
  N3["Add activity"]
  N4["new activity is selected"]
  B1["Feature disabled or invalid name: inline creation unavailable or field error"]
  B2["Close form: no allocation is saved unless Save is chosen"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
  N3 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  A["AllocationTargetFields: inline activity entry when enabled"] --> B["useAllocationTargetState: addActivity handler"]
  B --> C["addActivity typed catalogue write for selected scope"]
  C -->|created| D["Select new activity in Activity field"]
  C -->|invalid/failure| E["Show field/form error; retain form"]
  D --> F["Allocation remains a draft until Save"]
```

**Code references:**

- [AllocationTargetFields.tsx](../../apps/frontend/src/components/scheduler/AllocationTargetFields.tsx)
- [useAllocationTargetState.ts](../../apps/frontend/src/components/scheduler/useAllocationTargetState.ts)
- [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts)
- [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts)
