# US-SCH-18 — Quick-create defaults to the date you're looking at

As an Editor, I want quick-create to use the date at the left edge of the visible Schedule so that the default matches the period I am viewing.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- The row **+** uses the date at the left edge of the visible timeline as the new entry’s Start and End.

## User flow

```mermaid
flowchart TD
  A["Editor pans to another date range"]
  B["Select + on a resource row"]
  C["The new allocation form starts at the visible left edge"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  Scroll["useVisibleStartDate exposes callback using live scrollLeft and geometry"] --> Click["ResourceActions calls visibleStartDate at eligible row + click"]
  Click --> Seed["setDialog supplies selected resource and same start/end date"]
  Seed -->|Time off, tracked row| Off["SchedulerDialog opens TimeOffForm with literal dates"]
  Seed -->|Work| Work["SchedulerDialog opens AllocationDialog"]
  Work -->|external or Hours| Dates["AllocationScheduleFields shows Start and End"]
  Work -->|tracked Days or Blocks| Counted["AllocationScheduleFields shows counted span"]
```

`useVisibleStartDate` falls back to a materialized date when the live geometry cannot supply one. Time off + is absent for external rows. This flow ends at form initialization. [US-ALL-01](../allocation/US-ALL-01-create.md) and [US-TOF-01](../time-off/US-TOF-01-book-time-off.md) trace persistence and dismissal.

**Code references:**

- [useSchedulerViewport.ts](../../apps/frontend/src/components/scheduler/useSchedulerViewport.ts#L269)
- [useSchedulerViewport.ts](../../apps/frontend/src/components/scheduler/useSchedulerViewport.ts#L376)
- [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx#L130)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx#L39)
- [useAllocationScheduleState.ts](../../apps/frontend/src/components/scheduler/useAllocationScheduleState.ts#L188)
- [AllocationScheduleFields.tsx](../../apps/frontend/src/components/scheduler/AllocationScheduleFields.tsx#L281)
- [useSchedulerViewport.test.tsx](../../apps/frontend/src/components/scheduler/useSchedulerViewport.test.tsx#L72)
