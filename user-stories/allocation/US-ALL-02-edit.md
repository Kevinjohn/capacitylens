# US-ALL-02 — Edit an existing allocation

As an Editor, I want to change an allocation in place so that an updated plan keeps its existing booking.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Schedule (`/`)
**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)
**Source:** [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx), [AllocationScheduleFields.tsx](../../apps/frontend/src/components/scheduler/AllocationScheduleFields.tsx)

## Acceptance criteria

| Field               | Control           | Required/default/conditions                                                                                                                                                   |
| ------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assignee            | Select            | Required; prefilled with the current resource                                                                                                                                 |
| Project             | Select            | Prefilled with the saved project scope; options: Internal, No specific project, then projects sorted by client and name; a placeholder limits the choice to its bound project |
| Activity            | Select            | Required; prefilled with the current activity; choices follow the selected Project                                                                                            |
| Task                | Text input        | Optional; up to 100 characters; shown only when the company enables Show task field in schedule; prefilled                                                                    |
| Start Date          | Date input        | Required; prefilled with the saved start date                                                                                                                                 |
| End                 | Date input        | Hours mode and external resources only; required; prefilled with the saved end date                                                                                           |
| Hours / day         | Select            | Hours mode, not for external resources; prefilled; 1 h, 2 h - quarter day, 4 h - half day or 8 h - full day                                                                   |
| Days of work        | Number input      | Days mode, not for external resources; required; greater than 0; 0.5 step; prefilled                                                                                          |
| Days over           | Number input      | Days and Blocks modes, not for external resources; prefilled; whole number from 1 to the supported maximum; disabled when the person has no effective working days            |
| Status              | Segmented control | Prefilled with the saved status; Confirmed, Tentative or Completed                                                                                                            |
| Note                | Text input        | Optional; prefilled with the saved note                                                                                                                                       |
| Ignore working days | Checkbox          | Prefilled with the saved value; hidden for external resources                                                                                                                 |

- Save updates the existing allocation; Cancel leaves its saved values unchanged.

## User flow

```mermaid
flowchart TD
  N1["Open an allocation"]
  N2["change its fields"]
  N3["Save"]
  N4["updated booking appears"]
  B1["Cancel/close: saved booking remains unchanged"]
  B2["Invalid or stale draft: error shown; correct or close"]
  B3["Save failure: error shown; form stays open"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
  N3 -.-> B2
  N3 -.-> B3
```

## Code flow

```mermaid
flowchart TD
  A["AllocationModal edit dialog"] --> B["allocationSubmit validates saved-value draft"]
  B -->|valid| C["allocationSlice.updateAllocation"]
  B -->|invalid or stale| I["Form error; saved row remains"]
  C --> D["Planning cache controller executes command"]
  D --> E["createStorePlanningTransport selects server HTTP or demo memory transport"]
  E -->|server| F["planningTransport sends api.planning.allocation.update"]
  F --> J["Request refusal or transport failure returns to allocationSubmit"]
  J --> I["Form error; draft remains available"]
  F --> G["PlanningController.mutatePlanning executes scoped writeRow"]
  G --> H["Acknowledgement reconciles store; Schedule redraws"]
  E -->|demo| H
```

**Code references:**

- [writer.ts](../../apps/backend/app/services/planning/writer.ts)

- [execute.ts](../../apps/backend/app/services/planning/execute.ts)

- [planning.ts](../../apps/backend/app/services/planning.ts)

- [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts)
- [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts)
- [volatilePlanningTransport.ts](../../apps/frontend/src/data/planning/volatilePlanningTransport.ts)
- [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts)
- [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)
- [useAllocationModalState.ts](../../apps/frontend/src/components/scheduler/useAllocationModalState.ts)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts)
- [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts)
- [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts)
