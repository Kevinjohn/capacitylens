# US-ALL-05 — Add a new activity inline from the modal

As an Editor, I want to add an activity from the allocation form so that I can assign new work without leaving the Schedule.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Schedule (`/`)
**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)
**Source:** [AllocationTargetFields.tsx](../../apps/frontend/src/components/scheduler/AllocationTargetFields.tsx), [AllocationScheduleFields.tsx](../../apps/frontend/src/components/scheduler/AllocationScheduleFields.tsx)

## Acceptance criteria

| Field             | Control    | Required/default/conditions                                                                    |
| ----------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| New activity name | Text input | Required to add an activity; available only when the company enables inline activity creation. |

- **Add activity** creates an activity in the selected scope and selects it in the Activity control.
