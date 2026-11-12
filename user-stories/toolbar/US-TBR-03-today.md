# US-TBR-03 — Re-centre on Today

As an Editor, I want Today to recenter the timeline so that I can return to the current planning period.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)

## Acceptance criteria

- **Today** returns the schedule to the start of the current week in the company time zone.

## User flow

```mermaid
flowchart TD
  A["Viewer selects Today"]
  B["Schedule returns to the current company week"]
  C["Viewport scrolls to the recentered date"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  A["ToolbarDateNavigation invokes goToToday"] --> B["schedulerSlice.goToToday resolves company timezone and week start"]
  B --> C["recenterOn updates focus and recenter token"]
  C --> D["useSchedulerViewport aligns scroll to focus date"]
  D --> E["SchedulerGrid renders current week"]
```

**Code references:** [ToolbarDateNavigation.tsx](../../apps/frontend/src/components/scheduler/ToolbarDateNavigation.tsx), [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx), [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts), [storeInternal.ts](../../apps/frontend/src/store/storeInternal.ts), [useSchedulerViewport.ts](../../apps/frontend/src/components/scheduler/useSchedulerViewport.ts)
