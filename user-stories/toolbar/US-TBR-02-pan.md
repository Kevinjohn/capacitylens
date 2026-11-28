# US-TBR-02 — Pan a week back / forward

As an Editor, I want to pan one week backward or forward so that I can move through the schedule in manageable steps.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)

## Acceptance criteria

- **Prev** ("Back one week") and **Next** ("Forward one week") move the schedule window by seven days.
- The icon-only controls are named **Prev** and **Next** for assistive technology.

## User flow

```mermaid
flowchart TD
  A["Viewer selects Prev or Next"]
  B["The timeline moves one week"]
  C["The left edge aligns with the configured week start"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  Nav["ToolbarDateNavigation Prev or Next invokes panDays with minus or plus seven"] --> Origin["schedulerSlice changes ui.originDate"]
  Origin --> View["useViewportAlignment re-anchors changed materialized range to configured week start"]
  Origin --> Window["buildPlanningCapacity builds the new window's figures from the rows already read"]
  Window --> Cues["Row cues refresh without a server request"]
```

Prev and Next are available to Schedule readers. The action changes display state only; it sends no request.

**Code references:**

- [ToolbarDateNavigation.tsx](../../apps/frontend/src/components/scheduler/ToolbarDateNavigation.tsx#L35)
- [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts#L195)
- [useSchedulerViewport.ts](../../apps/frontend/src/components/scheduler/useSchedulerViewport.ts#L183)
- [useStore.ts](../../apps/frontend/src/store/useStore.ts#L63)
- [schedulerRowModel.ts](../../apps/frontend/src/components/scheduler/schedulerRowModel.ts#L120)
