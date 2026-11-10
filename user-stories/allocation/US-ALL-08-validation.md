# US-ALL-08 — The modal rejects bad input

As an Editor, I want invalid allocation fields to be identified so that I can correct the booking before it is saved.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)

## Acceptance criteria

| Field        | Control      | Required/default/conditions                           |
| ------------ | ------------ | ----------------------------------------------------- |
| Activity     | Select       | Required.                                             |
| Start        | Date input   | Required; valid date.                                 |
| End          | Date input   | Required; same date or later than Start.              |
| Hours / day  | Select       | Required for capacity-based modes; greater than zero. |
| Days of work | Number input | Required in Days mode; greater than zero.             |

## User flow

```mermaid
flowchart TD
  N1["Enter allocation fields"]
  N2["Save"]
  N3["invalid activity, dates or quantity are marked"]
  N4["correct values and retry"]
  B1["Still invalid ; then  no write"]
  B2["Cancel ; then  discard unsaved draft"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
  N3 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  A["AllocationModal submit"] --> B["allocationSubmit.parseAllocationCommandDraft"]
  B --> C["validateAllocationDraft checks date range and mode quantity"]
  C -->|invalid| D["fail(field, message); return without mutation"]
  C -->|valid| E["assignment and placement checks"]
  E -->|valid| F["Typed addAllocation/updateAllocation"]
  E -->|invalid| D
```

**Code references:**

- [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts)
- [allocationDraft.ts](../../apps/frontend/src/components/scheduler/allocationDraft.ts)
