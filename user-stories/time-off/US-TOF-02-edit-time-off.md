# US-TOF-02 — Edit a time-off entry

As an Editor, I want to edit one time-off entry so that its dates and type stay current without changing other occurrences.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Time off page
**Documentation:** [time-off.md](../../docs-src/using/time-off.md)
**Source:** [TimeOffForm.tsx](../../apps/frontend/src/components/time-off/TimeOffForm.tsx), [TimeOffRepeatFields.tsx](../../apps/frontend/src/components/time-off/TimeOffRepeatFields.tsx)

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
  Row["TimeOffList date-specific Edit for planning writers"] --> Form["TimeOffForm captures opening row and prefills draft"]
  Form -->|Cancel| Close["Dismiss form"]
  Form --> Prep["useEditSubmit runs prepareTimeOffSave"]
  Prep -->|invalid| Field["Field error, draft stays open"]
  Prep -->|valid| Stale{"Opening row still current?"}
  Stale -->|no| Reopen["Stale error; close and reopen to edit"]
  Stale -->|yes| Diff["updateTimeOff → buildTimeOffUpdate"]
  Diff -->|no diff| Close
  Diff -->|changes| Send["timeOff.update with expectedUpdatedAt"]
  Send --> Commit["commit checks live write access and company revision; writeEntity checks row timestamp and fields"]
  Commit -->|committed and reconciled| Close
  Commit -->|known refusal| Error["Form error; release pending guard; stale refusal refreshes"]
  Commit -->|lost or invalid reply| Unknown["Canonical read may show edited row; reset history without replay"]
```

An Editor patch omits the protected note, preserving the stored value. Owners and Admins can change or clear it. Repeat controls are absent on edit.

**Code references:**

- [TimeOffList.tsx](../../apps/frontend/src/components/time-off/TimeOffList.tsx#L98)
- [TimeOffForm.tsx](../../apps/frontend/src/components/time-off/TimeOffForm.tsx#L66)
- [TimeOffForm.tsx](../../apps/frontend/src/components/time-off/TimeOffForm.tsx#L98)
- [timeOffFormSubmission.ts](../../apps/frontend/src/components/time-off/timeOffFormSubmission.ts#L151)
- [useEditSubmit.ts](../../apps/frontend/src/hooks/useEditSubmit.ts#L44)
- [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts#L270)
- [planningIntents.ts](../../apps/frontend/src/data/planning/planningIntents.ts#L249)
- [entity_write_service.ts](../../apps/backend/app/services/planning/entity_write_service.ts#L75)
- [restricted_fields.ts](../../apps/backend/app/services/planning/restricted_fields.ts#L30)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L9)
- [planning_service.ts](../../apps/backend/app/services/planning_service.ts#L222)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
- [TimeOffList.test.tsx](../../apps/frontend/src/components/time-off/TimeOffList.test.tsx#L444)
