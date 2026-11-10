# US-SCH-16 — Collapse and expand a discipline group

As an Editor, I want to collapse and expand discipline groups so that I can focus the Schedule on selected teams.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Selecting a discipline header collapses its resource rows and shows a hidden-row count.
- Selecting it again restores the rows.

## User flow

```mermaid
flowchart TD
  A["Viewer selects a discipline heading"]
  B["Resource rows collapse and hidden count appears"]
  C["Viewer selects the heading again"]
  D["Resource rows return"]
  A --> B
  B --> C
  C --> D
```

## Code flow

```mermaid
flowchart TD
  A["SchedulerGridGroupHeader button calls toggleGroup"] --> B["schedulerSlice.toggleGroup updates ui.collapsedGroups"]
  B --> C["useSchedulerGridModel projects grouped rows"]
  C --> D["SchedulerGridRows omits collapsed rows and renders header count"]
```

**Code references:** [SchedulerGridGroupHeader.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridGroupHeader.tsx), [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts), [useSchedulerGridModel.ts](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts), [SchedulerGridRows.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRows.tsx)
