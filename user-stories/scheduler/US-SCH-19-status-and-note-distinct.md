# US-SCH-19 — Allocation status and notes are visually distinct on the bar

As an Editor, I want status and notes to look distinct on allocation bars so that I can read important booking details at a glance.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Tentative, completed and confirmed allocations have distinct visual treatments.
- A note marker appears only on allocations that have a note.

## User flow

```mermaid
flowchart TD
  A["Viewer looks at allocation bars"]
  B["Tentative, completed and confirmed states look distinct"]
  C["A note marker appears only when a note exists"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  Model["schedulerRowModel builds BarLayout from projected allocation"] --> Status["BarTrigger in AllocationBarView sets data-status"]
  Status -->|Tentative| Tentative["Render hatching and dashed inline border"]
  Status -->|Completed| Completed["Render check glyph"]
  Status -->|Confirmed| Standard["Render standard bar"]
  Model --> Note["AllocationBarView renders bullet when a Note exists"]
  Model --> Name["AllocationBar builds role-specific accessible name"]
  Name -->|editable| Presence["Announce Note presence"]
  Name -->|read-only| Text["Include Note text"]
```

The accessible label names Tentative and Completed where applicable. Confirmed uses the ordinary label.

**Code references:**

- [schedulerRowModel.ts](../../apps/frontend/src/components/scheduler/schedulerRowModel.ts#L93)
- [AllocationBarView.tsx](../../apps/frontend/src/components/scheduler/AllocationBarView.tsx#L56)
- [AllocationBarView.tsx](../../apps/frontend/src/components/scheduler/AllocationBarView.tsx#L111)
- [AllocationBar.tsx](../../apps/frontend/src/components/scheduler/AllocationBar.tsx#L50)
- [metadata.ts](../../apps/frontend/src/lib/metadata.ts#L69)
