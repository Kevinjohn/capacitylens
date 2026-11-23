# US-TBR-05 — Switch Work / Time-off draw mode

As an Editor, I want to switch between Work and Time off draw modes so that a lane gesture opens the matching form.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)

## Acceptance criteria

- Editors see a **Draw mode** control with **Work** (the default) and **Time off**.
- In Work mode, drawing across a resource lane opens the allocation form with that resource and date range. In Time off mode it opens the time-off form instead, allocation bars cannot be selected or dragged, and drawing on an external resource opens nothing.
- A draw that starts on a day the resource does not work or has time off opens nothing; in Work mode a closure day also blocks it.

## User flow

```mermaid
flowchart TD
  A["Editor chooses a draw mode"]
  B["Work mode: drawing opens an allocation form"]
  C["Time off mode: drawing opens a time-off form"]
  D["Save applies the selected action; Cancel closes without saving"]
  A --> B
  A --> C
  B --> D
  C --> D
```

## Code flow

```mermaid
flowchart TD
  Toolbar["SchedulerToolbar Show filters mounts SchedulerToolbarFilters"] --> Access{"Can edit planning?"}
  Access -->|no| Hidden["Draw mode control absent"]
  Access -->|yes| Mode["Draw mode control calls setDrawMode; default Work"]
  Mode --> State["SchedulerGrid announces mode change from ui.drawMode"]
  State --> Bars["BarsLayer makes work bars inert in Time off"]
  State --> Plus["ResourceActions + uses mode; hide Time off + on external rows"]
  State --> Draw["beginGesture checks creationBlocked including closures in both modes"]
  Draw -->|blocked or cancelled| None["No form from gesture"]
  Draw -->|release eligible| Open["openDrawDialog checks proposed start; Time off excludes closures and external rows"]
  Open -->|accepted| Form["SchedulerDialog opens mode-specific seeded form"]
  Open -->|refused| None
  Plus -->|enabled and clicked| Form
```

Mode changes are local. Work defaults on entry. [Draw Work](../scheduler/US-SCH-02-draw-allocation.md), [draw Time off](../scheduler/US-SCH-03-draw-time-off.md) and [row +](../scheduler/US-SCH-17-row-quick-create.md) trace their form boundaries.

**Code references:**

- [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx#L77)
- [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx#L152)
- [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts#L50)
- [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts#L218)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx#L116)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx#L152)
- [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx#L34)
- [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx#L130)
- [schedulerRowModel.ts](../../apps/frontend/src/components/scheduler/schedulerRowModel.ts#L120)
- [useResourceLaneInteraction.ts](../../apps/frontend/src/components/scheduler/useResourceLaneInteraction.ts#L53)
