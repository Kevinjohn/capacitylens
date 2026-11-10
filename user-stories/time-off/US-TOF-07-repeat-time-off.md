# US-TOF-07 — Create repeated personal time off

As an Editor, I want to create a finite batch of repeating time-off entries so that regular absences can be recorded in one form.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Add time off form on the Time off page
**Documentation:** [time-off.md](../../docs-src/using/time-off.md)
**Source:** [TimeOffRepeatFields.tsx](../../apps/frontend/src/components/timeoff/TimeOffRepeatFields.tsx), [timeOffFormSubmission.ts](../../apps/frontend/src/components/timeoff/timeOffFormSubmission.ts)

## Acceptance criteria

| Field        | Control    | Required/default/conditions                                                                                                       |
| ------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Repeat       | Select     | Defaults to Doesn’t repeat; offers weekly, every two/three/four weeks, monthly on date or monthly on last weekday.                |
| Repeat until | Date input | Required when repeating; suggested from Start; maximum is limited from Start; includes an occurrence starting on the cutoff date. |

- Saving creates independent dated entries; each occurrence can be edited or deleted on its own.

## User flow

```mermaid
flowchart TD
  N1["Open Add time off"]
  N2["choose repeat and cutoff"]
  N3["review generated dates"]
  N4["Save"]
  N5["separate entries are created"]
  B1["Invalid cutoff/pattern; repeat field error"]
  B2["Write error; form stays available with error"]
  B3["Cancel; none created"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N4 --> N5
  N4 -.-> B1
  N4 -.-> B2
  N1 -.-> B3
```

## Code flow

```mermaid
flowchart TD
  A["TimeOffRepeatFields: choose repeat and cutoff"] --> B["timeOffFormSubmission.buildTimeOffDraftsForSave"]
  B -->|valid| C["Build dated independent drafts"]
  B -->|invalid| D["Repeat field error; no mutation"]
  C --> E["addTimeOffs"]
  E --> F["typedPlanningActions.addTimeOffs builds timeOff.repeat intent"]
  F --> G["Planning cache reconciles independent time-off rows"]
```

**Code references:**

- [TimeOffForm.tsx](../../apps/frontend/src/components/timeoff/TimeOffForm.tsx)
- [TimeOffRepeatFields.tsx](../../apps/frontend/src/components/timeoff/TimeOffRepeatFields.tsx)
- [timeOffFormSubmission.ts](../../apps/frontend/src/components/timeoff/timeOffFormSubmission.ts)
- [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts)
- [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts)
