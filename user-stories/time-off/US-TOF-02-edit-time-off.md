# US-TOF-02 — Edit a time-off entry

As an Editor, I want to edit one time-off entry so that its dates and type stay current without changing other occurrences.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Time off page
**Documentation:** [time-off.md](../../docs-src/using/time-off.md)
**Source:** [TimeOffForm.tsx](../../apps/frontend/src/components/timeoff/TimeOffForm.tsx), [TimeOffRepeatFields.tsx](../../apps/frontend/src/components/timeoff/TimeOffRepeatFields.tsx)

## Acceptance criteria

| Field    | Control    | Required/default/conditions                                                                 |
| -------- | ---------- | ------------------------------------------------------------------------------------------- |
| Resource | Select     | Required; defaults from the entry point when supplied; excludes external parties.           |
| Start    | Date input | Required; defaults to today unless a date is supplied by the entry point.                   |
| End      | Date input | Required; defaults to Start unless supplied; cannot precede Start.                          |
| Type     | Select     | Required; defaults to Holiday; options Holiday, Sick, Unpaid or Other.                      |
| Note     | Text input | Optional; editable and visible only to roles permitted to see time-off notes (Owner/Admin). |

- Save updates this entry only; repeating occurrences remain independent.
