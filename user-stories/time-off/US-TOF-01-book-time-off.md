# US-TOF-01 — Book time off for a resource

As an Editor, I want to record personal time off so that the affected dates reduce the resource’s available capacity.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Time off page
**Documentation:** [time-off.md](../../docs-src/using/time-off.md)
**Source:** [TimeOffForm.tsx](../../apps/frontend/src/components/timeoff/TimeOffForm.tsx), [TimeOffRepeatFields.tsx](../../apps/frontend/src/components/timeoff/TimeOffRepeatFields.tsx)

## Acceptance criteria

| Field        | Control    | Required/default/conditions                                                                                              |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Resource     | Select     | Required; defaults from the entry point when supplied; excludes external parties.                                        |
| Start        | Date input | Required; defaults to today unless a date is supplied by the entry point.                                                |
| End          | Date input | Required; defaults to Start unless supplied; cannot precede Start.                                                       |
| Type         | Select     | Required; defaults to Holiday; options Holiday, Sick, Unpaid or Other.                                                   |
| Repeat       | Select     | Create only; defaults to Doesn’t repeat; weekly, every two/three/four weeks, monthly on date or monthly on last weekday. |
| Repeat until | Date input | Required for repeating entries; includes an occurrence starting on the cutoff date.                                      |
| Note         | Text input | Optional; editable and visible only to roles permitted to see time-off notes (Owner/Admin).                              |

- Save creates the time-off entry; Cancel leaves the schedule unchanged.
