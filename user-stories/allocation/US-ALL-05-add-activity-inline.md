# US-ALL-05 — Add a new activity inline from the dialog

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
  Form["AllocationTargetFields checks canEdit and inline activity setting"] -->|disabled| None["Inline control absent"]
  Form -->|enabled| Inline["useAddInlineActivity validates name and captures selection version"]
  Inline -->|invalid| Field["Name error; no write"]
  Inline --> Send["addActivity sends catalogue.create in selected scope"]
  Send --> Commit["commit checks live write access and revision; writeEntity saves activity"]
  Commit -->|committed and reconciled| Basis["Advance draft basis only for sole acknowledged addition"]
  Basis --> Option["Refresh inline option; select it only if selection version still matches"]
  Option --> Name["Clear submitted name only if it still matches"]
  Commit -->|refused| Error["Form error; stale refusal refreshes"]
  Commit -->|lost or invalid reply| Unknown["Canonical read may contain activity; history resets"]
```

If the allocation draft is later discarded, the separately acknowledged activity remains in the catalogue.

**Code references:**

- [AllocationTargetFields.tsx](../../apps/frontend/src/components/scheduler/AllocationTargetFields.tsx#L149)
- [useAllocationTargetState.ts](../../apps/frontend/src/components/scheduler/useAllocationTargetState.ts#L216)
- [useAllocationDialogState.ts](../../apps/frontend/src/components/scheduler/useAllocationDialogState.ts#L70)
- [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts#L117)
- [planning_execution_service.ts](../../apps/backend/app/services/planning/planning_execution_service.ts#L244)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L9)
- [planning_service.ts](../../apps/backend/app/services/planning_service.ts#L222)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
- [AllocationDialog.activity-and-task.test.tsx](../../apps/frontend/src/components/scheduler/AllocationDialog.activity-and-task.test.tsx#L28)
