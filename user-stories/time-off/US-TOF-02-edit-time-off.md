# US-TOF-02 — Edit a time-off entry

As an Editor, I want to edit one time-off entry so that its dates and type stay current without changing other occurrences.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Time off page
**Documentation:** [time-off.md](../../docs-src/using/time-off.md)
**Source:** [TimeOffForm.tsx](../../apps/frontend/src/components/timeoff/TimeOffForm.tsx), [TimeOffRepeatFields.tsx](../../apps/frontend/src/components/timeoff/TimeOffRepeatFields.tsx)

## Acceptance criteria

| Field    | Control    | Required/default/conditions                                            |
| -------- | ---------- | ---------------------------------------------------------------------- |
| Resource | Select     | Required; prefilled with the saved resource; excludes external parties |
| Start    | Date input | Required; prefilled with the saved start date                          |
| End      | Date input | Required; prefilled with the saved end date; cannot precede Start      |
| Type     | Select     | Prefilled with the saved type; options Holiday, Sick, Unpaid or Other  |
| Note     | Text input | Optional; prefilled; shown only to Owners and Admins                   |

- Save updates this entry only; repeating occurrences remain independent.

## User flow

```mermaid
flowchart TD
  N1["Open one time-off entry"]
  N2["edit its resource, dates, type or permitted note"]
  N3["Save"]
  N4["only that entry changes"]
  B1["Invalid values or save failure: error shown; form stays open"]
  B2["Cancel: saved entry unchanged"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
  N3 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  A["TimeOffForm: edit saved entry"] --> B["timeOffFormSubmission: validate changed fields"]
  B -->|valid| C["updateTimeOff(id, patch)"]
  B -->|invalid| D["Field error; no mutation"]
  C --> E["typedPlanningActions.updateTimeOff; planning reconciliation"]
  E --> F["Only selected entry updates"]
```

**Code references:**

- [TimeOffForm.tsx](../../apps/frontend/src/components/timeoff/TimeOffForm.tsx)
- [timeOffFormSubmission.ts](../../apps/frontend/src/components/timeoff/timeOffFormSubmission.ts)
- [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts)
- [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts)
