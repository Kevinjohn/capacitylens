# US-TBR-05 — Switch Work / Time-off draw mode

As an Editor, I want to switch between Work and Time off draw modes so that a lane gesture opens the matching form.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)

## Acceptance criteria

- The draw-mode control switches between **Work** and **Time off**.
- A lane draw opens the matching allocation or time-off form.
