# US-SCH-02 — Draw a new allocation across empty lane space

As an Editor, I want to draw a date range on an empty resource lane so that I can start an allocation with its resource and dates filled in.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- In Work mode, drawing across an empty resource lane opens a prefilled allocation form.
- The form uses that resource and the drawn date range.

## User flow

```mermaid
flowchart TD
  A["Editor draws across an empty resource lane in Work mode"]
  B["A new allocation form opens with that resource and date span"]
  C["Editor chooses Save"]
  D["Booking is created"]
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
  Grid["SchedulerGridRow supplies onDraw for planning writers"] --> Down["beginGesture checks primary pointer and creationBlocked"]
  Down -->|blocked or no callback| None["No drawing or form"]
  Down --> Preview["GestureLayers shows selected span"]
  Preview -->|Escape, pointer cancel or geometry changes| None
  Preview --> Up["finishGesture rechecks pointer-down day and returns click date or sorted inclusive span"]
  Up -->|blocked| None
  Up --> Open["openDrawDialog checks the proposed first Work date"]
  Open -->|blocked or missing resource| None
  Open -->|allowed| Dialog["SchedulerDialog seeds AllocationDialog"]
```

This flow ends at the seeded `AllocationDialog`. [US-ALL-01](../allocation/US-ALL-01-create.md) traces Save, field and server refusal, and dismissal.

**Code references:**

- [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx#L260)
- [useResourceLaneInteraction.ts](../../apps/frontend/src/components/scheduler/useResourceLaneInteraction.ts#L34)
- [useResourceLaneInteraction.ts](../../apps/frontend/src/components/scheduler/useResourceLaneInteraction.ts#L53)
- [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx#L138)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx#L116)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx#L39)
- [ResourceLane.test.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.test.tsx#L218)
