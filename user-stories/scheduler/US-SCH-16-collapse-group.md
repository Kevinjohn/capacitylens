# US-SCH-16 — Collapse and expand a discipline group

As an Editor, I want to collapse and expand discipline groups so that I can focus the Schedule on selected teams.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Selecting a group header collapses its resource rows and shows **{count} hidden**.
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
  Group["SchedulerGridGroupHeader renders toggle for each visible group"] --> Toggle["toggleGroup updates ui.collapsedGroups"]
  Toggle --> Flatten["useSchedulerGridVirtualization → flattenVisibleItems"]
  Flatten -->|collapsed| Count["Omit resource rows and show projected hidden count"]
  Flatten -->|expanded| Rows["Virtualize group rows and update expanded state"]
```

This is a view action available to Schedule readers. The same toggle re-expands the group.

**Code references:**

- [SchedulerGridGroupHeader.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridGroupHeader.tsx#L26)
- [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts#L222)
- [useSchedulerGridVirtualization.ts](../../apps/frontend/src/components/scheduler/useSchedulerGridVirtualization.ts#L25)
