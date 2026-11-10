# US-SCH-13 — Per-resource near-term utilisation flag

As an Editor, I want a near-term utilisation warning so that I can see over-capacity coming within the next 14 days.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- A resource’s utilisation flag turns red when the fixed 14-day forward window contains over-capacity.
- The flag does not change when the visible date range changes.
