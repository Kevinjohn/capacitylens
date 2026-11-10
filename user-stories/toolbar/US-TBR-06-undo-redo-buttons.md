# US-TBR-06 — Undo / Redo toolbar buttons

As an Editor, I want toolbar Undo and Redo controls so that I can reverse or reapply a planning change without a keyboard shortcut.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)

## Acceptance criteria

- **Undo** and **Redo** reverse and reapply acknowledged planning changes.
- Each button is disabled when its corresponding history stack is empty.

## User flow

```mermaid
flowchart TD
  A["Editor selects a history action"]
  B["Undo reverses or Redo reapplies a planning change"]
  C["Rejected action appears as an error notice"]
  A --> B
  A --> C
```

## Code flow

```mermaid
flowchart TD
  A["SchedulerToolbarSections button calls runHistoryAction"] --> B["SchedulerToolbar passes undoPlanning or redoPlanning"]
  B --> C["allocationSlice delegates to planningCacheController.undo/redo"]
  C --> D["planningTransport executes typed history command"]
  D --> E["Store publishes response; SchedulerGrid rerenders or Toolbar shows error"]
```

**Code references:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx), [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts)
