# US-TBR-08 — Navigation re-anchors the left edge to the week start

As an Editor, I want navigation to align the Schedule with the configured week start so that week boundaries stay consistent.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)

## Acceptance criteria

- Weeks visible, Prev, Next and Today align the timeline to the configured week start.
- Free scrolling also snaps back to the configured week start when scrolling settles.

## User flow

```mermaid
flowchart TD
  A["Viewer scrolls freely or uses date navigation"]
  B["Free scroll settles: left edge aligns to company week start"]
  C["Weeks visible, Prev, Next and Today also align to week start"]
  A --> B
  A --> C
```

## Code flow

```mermaid
flowchart TD
  A["SchedulerGrid onScroll calls useSchedulerViewport.onScroll"] --> B["useViewportScrolling waits for idle interval"]
  B --> C["resolveWeekStartSnapTarget chooses company week edge"]
  C --> D["setScrollLeft aligns viewport"]
  E["Toolbar navigation changes dates or zoom"] --> F["useViewportAlignment anchors navigation to week start"]
```

**Code references:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx), [useSchedulerViewport.ts](../../apps/frontend/src/components/scheduler/useSchedulerViewport.ts), [resolveWeekStartSnapTarget.ts](../../apps/frontend/src/components/scheduler/resolveWeekStartSnapTarget.ts), [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)
