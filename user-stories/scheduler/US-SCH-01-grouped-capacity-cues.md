# US-SCH-01 — Resources grouped by discipline, with capacity cues

As an Editor, I want resources grouped by discipline with capacity cues so that I can spot workload and availability while planning.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- The Schedule groups resources by discipline and shows each resource’s utilisation.
- Over-capacity and unavailable days are visibly marked.
