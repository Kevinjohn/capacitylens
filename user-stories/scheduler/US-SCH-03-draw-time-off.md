# US-SCH-03 — Draw time off directly on a lane

As an Editor, I want to draw a date range in Time off mode so that I can start a time-off entry for the resource on that lane.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- In Time off mode, drawing on a resource lane opens a prefilled time-off form.
- The lane’s work bars do not intercept the time-off draw.

## User flow

```mermaid
flowchart TD
  A["Editor selects Time off mode and draws across a resource lane"]
  B["The Add time off form opens with that resource and date span"]
  C["Editor chooses Save"]
  D["Time-off entry appears on the Schedule"]
  E["Editor chooses Cancel"]
  F["Form closes without saving"]
  A --> B
  B --> C
  C --> D
  B --> E
  E --> F
```

## Code flow

```mermaid
flowchart TD
  Grid["SchedulerGridRow provides onDraw for planning writers; Time off mode makes work bars inert"] --> Down["beginGesture checks the original down day, including company closures"]
  Down -->|blocked or no callback| None["No drawing or form"]
  Down --> Preview["GestureLayers shows selected span"]
  Preview -->|Escape, pointer cancel or geometry changes| None
  Preview --> Up["finishGesture rechecks original day, then returns click date or sorted span"]
  Up -->|blocked| None
  Up --> GridCheck["openDrawDialog checks sorted start without closures in Time off mode"]
  GridCheck -->|missing, external or blocked| None
  GridCheck -->|allowed| Form["SchedulerDialog seeds TimeOffForm"]
```

A reverse draw can reach a closure at its sorted start if the original pointer-down day was eligible. This flow ends at the seeded `TimeOffForm`. [US-TOF-01](../time-off/US-TOF-01-book-time-off.md) and [US-TOF-07](../time-off/US-TOF-07-repeat-time-off.md) trace the single and repeated saves.

**Code references:**

- [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx#L260)
- [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx#L34)
- [schedulerRowModel.ts](../../apps/frontend/src/components/scheduler/schedulerRowModel.ts#L120)
- [useResourceLaneInteraction.ts](../../apps/frontend/src/components/scheduler/useResourceLaneInteraction.ts#L34)
- [useResourceLaneInteraction.ts](../../apps/frontend/src/components/scheduler/useResourceLaneInteraction.ts#L53)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx#L116)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx#L39)
