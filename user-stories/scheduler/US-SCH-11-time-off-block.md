# US-SCH-11 — Time off renders as a labelled hatched block

As an Editor, I want time off shown as a labelled block so that time off is distinct from scheduled work.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Each time-off entry appears as a hatched block across its dates on the resource lane, behind the allocation bars. The block shows its type (Holiday, Sick, Unpaid or Other) when it is wider than 44 px; the type is always available to screen readers.

## User flow

```mermaid
flowchart TD
  A["Viewer opens a resource lane with time off"]
  B["A labelled hatched block appears on the covered dates"]
  C["Allocation bars remain a separate layer"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  Read["Authorized active planning projection contains personal time off and closures"] --> Model["createRowBuilder intersects personal intervals with materialized timeline"]
  Model -->|outside range or external row| None["No personal block"]
  Model -->|tracked row and overlap| Render["ResourceLane → ScheduleSignals draws hatched block with spoken type"]
  Render -->|over 44 px| Label["Show visible type"]
  Render -->|at most 44 px| Compact["Spoken type only"]
  Read --> Closure["SchedulerGridFooter draws separate company closure band"]
```

Allocation bars remain a distinct layer. Company closures use the separate footer band.

**Code references:**

- [schedulerRowModel.ts](../../apps/frontend/src/components/scheduler/schedulerRowModel.ts#L44)
- [schedulerRowModel.ts](../../apps/frontend/src/components/scheduler/schedulerRowModel.ts#L193)
- [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx#L103)
- [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx#L167)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx#L269)
- [SchedulerGrid.test.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.test.tsx#L238)
