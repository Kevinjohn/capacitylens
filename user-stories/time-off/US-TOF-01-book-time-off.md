# US-TOF-01 — Book time off for a resource

As an Editor, I want to record personal time off so that the affected dates reduce the resource’s available capacity.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Time off page
**Documentation:** [time-off.md](../../docs-src/using/time-off.md)
**Source:** [TimeOffForm.tsx](../../apps/frontend/src/components/time-off/TimeOffForm.tsx), [TimeOffRepeatFields.tsx](../../apps/frontend/src/components/time-off/TimeOffRepeatFields.tsx)

## Acceptance criteria

| Field        | Control    | Required/default/conditions                                                                                                                                     |
| ------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource     | Select     | Required; preselected when opened from a Schedule row, otherwise blank; excludes external parties; lists placeholders only when Show placeholders is on         |
| Start        | Date input | Required; defaults to today unless the entry point supplies a date                                                                                              |
| End          | Date input | Required; defaults to today unless the entry point supplies a date; cannot precede Start                                                                        |
| Type         | Select     | Defaults to Holiday; options Holiday, Sick, Unpaid or Other                                                                                                     |
| Repeat       | Select     | Create only; defaults to Doesn’t repeat; Weekly, Every 2 weeks, Every 3 weeks, Every 4 weeks, Monthly on day {day} or Monthly on the last {weekday}             |
| Repeat until | Date input | Required when repeating; suggested and capped at the end of the eleventh calendar month after Start’s month; includes an occurrence starting on the cutoff date |
| Note         | Text input | Optional; shown only to Owners and Admins                                                                                                                       |

- Save creates the time-off entry; Cancel leaves the schedule unchanged.

## User flow

```mermaid
flowchart TD
  N1["Open Time off"]
  N2["Add time off"]
  N3["choose resource, dates and type"]
  N4["Save"]
  N5["time off appears in list and schedule"]
  B1["Invalid dates/resource; field error; correct and retry"]
  B2["Save fails; error shown; form stays open"]
  B3["Cancel; no change"]
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
  Page["TimeOffList Add time off with planning write access"] --> Form["TimeOffForm initializes resource and dates"]
  Row["ResourceActions + in Time off mode"] -->|non-external, visible left edge| Form
  Draw["Time off lane gesture → openDrawDialog"] -->|allowed start| Form
  Draw -->|blocked or cancelled| Noop["No form or request"]
  Form -->|Cancel| Noop
  Form --> Check["useEditSubmit runs prepareTimeOffSave"]
  Check -->|invalid| Field["Field error, draft stays open"]
  Check -->|one-off| Send["persistNewTimeOff → addTimeOff sends timeOff.create"]
  Check -->|repeat| Repeat["addRepeatedTimeOff sends timeOff.repeat"]
  Send --> Commit["commit checks live write access and revision; writeEntity validates resource, range and restricted note"]
  Commit -->|committed and reconciled| Close["Clear form; list can show entry when end overlaps the company week or later"]
  Commit -->|known refusal| Error["Form error and release submit guard; stale refusal refreshes"]
  Commit -->|lost or invalid reply| Unknown["Canonical read may show entry; reset history without replay"]
```

The form disables controls during Save. Owner and Admin can edit the protected note. The repeat path continues in [US-TOF-07](US-TOF-07-repeat-time-off.md).

**Code references:**

- [TimeOffList.tsx](../../apps/frontend/src/components/time-off/TimeOffList.tsx#L157)
- [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx#L130)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx#L116)
- [TimeOffForm.tsx](../../apps/frontend/src/components/time-off/TimeOffForm.tsx#L151)
- [timeOffFormSubmission.ts](../../apps/frontend/src/components/time-off/timeOffFormSubmission.ts#L151)
- [useEditSubmit.ts](../../apps/frontend/src/hooks/useEditSubmit.ts#L44)
- [execute.ts](../../apps/backend/app/services/planning/execute.ts#L353)
- [restricted_fields.ts](../../apps/backend/app/services/planning/restricted_fields.ts#L30)
- [timeOffView.ts](../../apps/frontend/src/components/time-off/timeOffView.ts#L41)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L7)
- [planning.ts](../../apps/backend/app/services/planning.ts#L198)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
