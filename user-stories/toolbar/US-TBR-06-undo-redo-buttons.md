# US-TBR-06 — Undo / Redo toolbar buttons

As an Editor, I want toolbar Undo and Redo controls so that I can reverse or reapply a planning change without a keyboard shortcut.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)

## Acceptance criteria

- **Undo** and **Redo** reverse and reapply acknowledged planning changes.
- The buttons appear only for Editor or higher. Each is disabled while planning history is not ready or when it has nothing to undo or redo.

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
  Toolbar["SchedulerToolbar checks canEdit and isPlanningHistoryReady"] -->|hidden, disabled or guard blocks| None["No history request"]
  Toolbar -->|Undo| Undo["planningSessionSlice.undoPlanning → api.planning_undo.store"]
  Toolbar -->|Redo| Redo["planningSessionSlice.redoPlanning → api.planning_redo.store"]
  Undo --> Commit["runPlanningHistoryStep → commit checks live access, mutation identity and revision"]
  Redo --> Commit
  Commit --> Intent["Select stored inverse or forward for current company, actor, session, page and revision"]
  Intent -->|successful transaction| Receipt["Commit rows, revision, audit and next history; reconcile projected receipt and read"]
  Commit -->|empty history, stale or reused ID| Skip["Refuse without separate history cleanup"]
  Commit -->|other eligible operation refusal| Clear["Roll back and abandon history in separate transaction"]
  Skip --> Outcome["planningCache handles known refusal or unconfirmed identity"]
  Clear --> Outcome
  Commit -->|lost or invalid reply| Unknown["New history ID; canonical read and ask user to inspect the result"]
```

The server keeps up to 50 entries for the last writer. A stale refusal refetches without a second toolbar toast. Ordinary failures outside the cache’s existing error notice surface through the toolbar.

**Code references:**

- [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx#L14)
- [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx#L54)
- [planningReadiness.ts](../../apps/frontend/src/data/planning/planningReadiness.ts#L14)
- [planningSessionSlice.ts](../../apps/frontend/src/store/slices/planningSessionSlice.ts#L200)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L624)
- [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts#L136)
- [planning_undo_controller.ts](../../apps/backend/app/controllers/planning_undo_controller.ts#L5)
- [planning_redo_controller.ts](../../apps/backend/app/controllers/planning_redo_controller.ts#L5)
- [history_step.ts](../../apps/backend/app/services/planning/history_step.ts#L8)
- [planning.ts](../../apps/backend/app/services/planning.ts#L206)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L530)
- [history.spec.ts](../../apps/backend/tests/functional/planning/history.spec.ts#L113)
- [SchedulerToolbar.test.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.test.tsx#L456)
