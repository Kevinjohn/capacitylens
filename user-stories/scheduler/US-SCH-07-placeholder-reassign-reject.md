# US-SCH-07 — Reassigning onto a mismatched placeholder is rejected

As an Editor, I want a mismatched placeholder reassignment to be rejected so that work cannot drift from the placeholder’s bound project.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- A drop onto a placeholder bound to another project is rejected.
- The allocation stays unchanged and the user sees a reason.
