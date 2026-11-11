# US-TOF-07 — Create repeated personal time off

As an Editor, I want to create a finite batch of repeating time-off entries so that regular absences can be recorded in one form.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Add time off form on the Time off page
**Documentation:** [time-off.md](../../docs-src/using/time-off.md)
**Source:** [TimeOffRepeatFields.tsx](../../apps/frontend/src/components/timeoff/TimeOffRepeatFields.tsx), [timeOffFormSubmission.ts](../../apps/frontend/src/components/timeoff/timeOffFormSubmission.ts)

## Acceptance criteria

| Field        | Control    | Required/default/conditions                                                                                                                                     |
| ------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repeat       | Select     | Defaults to Doesn’t repeat; Weekly, Every 2 weeks, Every 3 weeks, Every 4 weeks, Monthly on day {day} or Monthly on the last {weekday}                          |
| Repeat until | Date input | Required when repeating; suggested and capped at the end of the eleventh calendar month after Start’s month; includes an occurrence starting on the cutoff date |

- Saving creates independent dated entries; each occurrence can be edited or deleted on its own.
