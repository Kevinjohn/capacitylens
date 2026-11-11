# US-FIL-02 — Filter by discipline

As a company member, I want to filter resources by discipline so that I can focus on one team.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Filter by discipline** appears only when disciplines are enabled and at least one exists; it lists the disciplines in schedule order after **All disciplines**.
- Selecting a discipline shows only the resources in that discipline; **All disciplines** restores every group.
