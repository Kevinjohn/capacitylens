# US-FIL-10 — Show resources without matching work

As a company member, I want to show unallocated resources while a client, project or activity lens is active so that I can see who has capacity outside the filtered work.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`), expanded filter row, after selecting a client, project or activity lens

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Show unallocated** is an unchecked checkbox shown only when a client, project or activity lens is active.
- Checking it restores resources without matching work as visible, dimmed rows; their capacity figures remain based on all work.
