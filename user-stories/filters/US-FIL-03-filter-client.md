# US-FIL-03 — Filter by client

As a company member, I want to filter allocations by client while keeping capacity cues truthful so that I can review client work without hiding total workload.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Filter by client** limits visible allocations to that client; capacity still includes all work.
- Show unallocated can reveal resources without matching work.
