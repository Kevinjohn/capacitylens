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
  A["SchedulerToolbarSections SegmentedControl calls setDrawMode"] --> B["schedulerSlice stores local drawMode"]
  B --> C["SchedulerGridRow provides draw callback for Editor"]
  C --> D["ResourceLane interaction sends resource and dates to createFromDraw"]
  D --> E["openDrawModal selects allocation or time-off modal by drawMode"]
```

**Code references:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx), [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts), [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx), [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx), [useResourceLaneInteraction.ts](../../apps/frontend/src/components/scheduler/useResourceLaneInteraction.ts), [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)
