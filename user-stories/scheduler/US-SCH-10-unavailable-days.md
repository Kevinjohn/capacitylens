# US-SCH-10 — Unavailable days are greyed (weekends, non-working days, time off)

As an Editor, I want non-working and time-off days distinguished so that I can plan around available days.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- When the zoom is fine enough to draw day columns (at least 18 px per day), each day a resource cannot take new work — a non-working day, a closure or a time-off day — is shaded grey on its row. A personal half day is shaded on the lower half of the row.
- At coarser zoom the day shading is omitted; time off still shows as its own block (see [US-SCH-11](US-SCH-11-time-off-block.md)).
