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
  A["AllocationScheduleFields shows task when setting enables it"] --> B["useAllocationModalState supplies task value"]
  B --> C["allocationSubmit.parseOptionalTask validates and normalizes text"]
  C -->|valid| D["Include task in allocation draft"]
  C -->|invalid| E["Field error; no write"]
  D --> F["addAllocation/updateAllocation planning command"]
  F --> G["Reconciled allocation renders task"]
```

**Code references:**

- [AllocationScheduleFields.tsx](../../apps/frontend/src/components/scheduler/AllocationScheduleFields.tsx)
- [useAllocationModalState.ts](../../apps/frontend/src/components/scheduler/useAllocationModalState.ts)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts)
