# US-ALL-08 — The dialog rejects bad input

As an Editor, I want invalid allocation fields to be identified so that I can correct the booking before it is saved.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [AllocationDialog.tsx](../../apps/frontend/src/components/scheduler/AllocationDialog.tsx)

## Acceptance criteria

| Field        | Control      | Required/default/conditions                                                                                                  |
| ------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Activity     | Select       | Required (“Choose (or add) an activity.”); for a placeholder, must belong to its bound project                               |
| Start Date   | Date input   | Required; a new or reassigned allocation must start on an effective working day of the person and not on their time off      |
| End          | Date input   | Hours mode and external resources: required; not before Start; span up to 36,500 calendar days                               |
| Hours / day  | Select       | Hours mode: greater than 0 and at most 24                                                                                    |
| Days of work | Number input | Days mode: greater than 0; at most 24 hours per day over Days over                                                           |
| Days over    | Number input | Days and Blocks modes: whole number from 1 to the supported maximum                                                          |
| Repeat until | Date input   | When repeating: required; not before today or Start; at most six calendar months after Start; must allow at least one repeat |

## User flow

```mermaid
flowchart TD
  N1["Enter allocation fields"]
  N2["Save"]
  N3["invalid activity, dates or quantity are marked"]
  N4["correct values and retry"]
  B1["Still invalid: no write"]
  B2["Cancel: discard unsaved draft"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
  N3 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  Save["createAllocationIntents: Save or Duplicate from editable form"] -->|Save edit basis stale| Stale["Reopen changed draft"]
  Save --> Check["parseAllocationIntentDraft owns field, date span and assignment validation"]
  Check -->|invalid| Field["Correct field and retry"]
  Check --> Placement["isNewPlacementRejected classifies the operation"]
  Placement -->|create or duplicate| First["Require effective working day and available start"]
  Placement -->|changed assignee| Reassign["Require available start and working day unless overridden"]
  Placement -->|same assignee| Diff["buildAllocationUpdate can return no diff"]
  First -->|blocked| Field
  Reassign -->|blocked| Field
  First -->|accepted| Commit["commit authorizes and checks revision before server validation and write"]
  Reassign -->|accepted| Diff
  Diff -->|unchanged| Closed["Close without request"]
  Diff -->|changed| Commit
  Commit -->|committed and reconciled| Saved["Close and show any advisory"]
  Commit -->|refused| Error["Form error; stale refusal refreshes"]
  Commit -->|lost or invalid reply| Unknown["Read canonical state and reset history"]
```

Later occurrences use the [repeat policy](US-ALL-09-repeat-creation.md). The server independently validates an accepted client draft. An unsent draft can also be canceled.

**Code references:**

- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts#L80)
- [allocationDraft.ts](../../apps/frontend/src/components/scheduler/allocationDraft.ts#L66)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts#L233)
- [planningIntents.ts](../../apps/frontend/src/data/planning/planningIntents.ts#L177)
- [entity_write_service.ts](../../apps/backend/app/services/planning/entity_write_service.ts#L89)
- [domain.ts](../../apps/backend/app/services/planning/entity_validation/domain.ts#L200)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L9)
- [planning_service.ts](../../apps/backend/app/services/planning_service.ts#L222)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
- [allocation_start_availability.spec.ts](../../apps/backend/tests/functional/planning/allocation_start_availability.spec.ts#L41)
