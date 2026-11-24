# US-ALL-10 — Add an optional task to an allocation

As an Editor, I want to add a short task description so that an allocation can carry context without replacing its activity.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Schedule (`/`)
**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)
**Source:** [AllocationScheduleFields.tsx](../../apps/frontend/src/components/scheduler/AllocationScheduleFields.tsx), [AllocationTargetFields.tsx](../../apps/frontend/src/components/scheduler/AllocationTargetFields.tsx)

## Acceptance criteria

| Field | Control    | Required/default/conditions                                                                                                                        |
| ----- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task  | Text input | Optional; up to 100 characters; shown only when the company enables Show task field in schedule. Hidden task text is kept when the setting is off. |

## User flow

```mermaid
flowchart TD
  N1["When task details are enabled, enter optional task text in allocation form"]
  N2["Save"]
  N3["task appears with the booking"]
  B1["Task field disabled: no task control shown"]
  B2["Invalid text: field error; correct and retry"]
  B3["Cancel: discard task draft"]
  N1 --> N2
  N2 --> N3
  N2 -.-> B1
  N2 -.-> B2
  N2 -.-> B3
```

## Code flow

```mermaid
flowchart TD
  Form["useAllocationScheduleState seeds a blank create Task or saved edit value"] --> Flag{"AllocationScheduleFields sees showTaskFieldInSchedule?"}
  Flag -->|enabled| Text["Task input may be entered or cleared"]
  Flag -->|disabled| Retain["Input absent; draft retains saved value"]
  Text --> Parse["parseAllocationIntentDraft → parseOptionalTask"]
  Retain --> Parse
  Parse -->|invalid| Field["Task field error"]
  Parse -->|valid| Diff["Task text or null enters the ordinary create/edit draft"]
  Diff -->|unchanged edit| Close["Close without dispatch"]
  Diff -->|changed| Commit["Scoped planning mutation authorizes and validates before persistence"]
  Commit -->|committed and reconciled| Display["AllocationBar and AllocationBarView include Task when enabled"]
  Commit -->|refused| Error["Form error; stale refusal refreshes"]
  Commit -->|lost or invalid reply| Unknown["Canonical read verifies saved value without replay"]
```

Save follows the [create](US-ALL-01-create.md) or [edit](US-ALL-02-edit.md) validation and placement path. Cancel discards the unsent Task change.

**Code references:**

- [AllocationScheduleFields.tsx](../../apps/frontend/src/components/scheduler/AllocationScheduleFields.tsx#L45)
- [useAllocationScheduleState.ts](../../apps/frontend/src/components/scheduler/useAllocationScheduleState.ts#L109)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts#L69)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts#L127)
- [planningIntents.ts](../../apps/frontend/src/data/planning/planningIntents.ts#L177)
- [AllocationBar.tsx](../../apps/frontend/src/components/scheduler/AllocationBar.tsx#L72)
- [AllocationBarView.tsx](../../apps/frontend/src/components/scheduler/AllocationBarView.tsx#L214)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L9)
- [planning.ts](../../apps/backend/app/services/planning.ts#L198)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
- [AllocationDialog.activity-and-task.test.tsx](../../apps/frontend/src/components/scheduler/AllocationDialog.activity-and-task.test.tsx#L259)
