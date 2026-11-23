# US-SET-09 — Snap the schedule to week boundaries

As a company member, I want the schedule to align to week boundaries so that weekly planning stays easy to read.

**Status:** Current — automatic Schedule behaviour; no Settings switch.
**Access:** Owner, Admin, Editor, Viewer
**Entry:** Schedule horizontal scrolling
**Documentation:** [Schedule](../../docs-src/using/read-the-schedule.md)
**Source:** [useSchedulerViewport.ts](../../apps/frontend/src/components/scheduler/useSchedulerViewport.ts), [displayPrefs.ts](../../apps/frontend/src/lib/displayPrefs.ts)

## Acceptance criteria

- After horizontal scrolling settles, the schedule aligns its left edge to the start of the company week.
- This happens automatically; there is no Settings switch.

## User flow

```mermaid
flowchart TD
A["Scroll the Schedule horizontally"] --> B["Stop scrolling"]
B --> C["The visible range aligns to the company week start"]
```

## Code flow

Date navigation follows its own company-week path, described in [US-TBR-08](../toolbar/US-TBR-08-week-start-snap.md#code-flow).

```mermaid
flowchart TD
  pref["readStoredWeekSnapOverride supplies the default-on test override"] --> scroll["useViewportScrolling observes scroll and publishes offsets"]
  scroll --> changed{"Horizontal movement without an allocation drag?"}
  changed -->|no| leave["Leave week snap untouched"]
  changed -->|yes| edge["Update left edge index"]
  edge --> enabled{"Week snapping enabled?"}
  enabled -->|no| leave
  enabled -->|yes| idle["Reset WEEK_SNAP_IDLE_MS timer"]
  idle --> target["If node still exists and no drag is active, resolveWeekStartSnapTarget"]
  target -->|valid offset| move["setScrollLeft applies the current left-edge week start offset"]
  target -->|no target| leave
```

**Code references:** [displayPrefs.ts:207](../../apps/frontend/src/lib/displayPrefs.ts#L207) · [runtimeSlice.ts:77](../../apps/frontend/src/store/slices/runtimeSlice.ts#L77) · [useSchedulerViewport.ts:279](../../apps/frontend/src/components/scheduler/useSchedulerViewport.ts#L279) · [resolveWeekStartSnapTarget.ts:23](../../apps/frontend/src/components/scheduler/resolveWeekStartSnapTarget.ts#L23)
