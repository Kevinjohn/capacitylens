# US-TBR-04 — Jump to a specific date (hidden from the toolbar)

As an Editor, I want to jump to a selected date so that I can inspect a specific future period; the toolbar control is currently hidden.

**Status:** Hidden — the date picker remains in code but the toolbar does not render it; redesign is deferred.

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [ToolbarDateNavigation.tsx](../../apps/frontend/src/components/scheduler/ToolbarDateNavigation.tsx), [JumpToDateInput.tsx](../../apps/frontend/src/components/scheduler/JumpToDateInput.tsx)

## Acceptance criteria

| Field        | Control           | Required/default/conditions                                                                                                        |
| ------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Jump to date | Native date input | Hidden from the current toolbar; when exposed, shows the focused date and repositions the schedule after a valid date is selected. |

## User flow

```mermaid
flowchart TD
  A["Intended: Viewer opens Schedule and chooses a date"]
  B["Currently unavailable: toolbar has no Jump to date control"]
  C["The intended date-jump flow cannot start"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  A["Current: SchedulerToolbarChrome renders ToolbarDateNavigation"] --> B["Current: ToolbarDateNavigation omits JumpToDateInput (SHOW_JUMP_TO_DATE is false)"]
  B --> C["Retained only: JumpToDateInput would call goToDate after a valid date"]
  C --> D["Retained model support: schedulerSlice.goToDate recenters to company week start"]
```

**Code references:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx), [ToolbarDateNavigation.tsx](../../apps/frontend/src/components/scheduler/ToolbarDateNavigation.tsx), [JumpToDateInput.tsx](../../apps/frontend/src/components/scheduler/JumpToDateInput.tsx), [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts)
