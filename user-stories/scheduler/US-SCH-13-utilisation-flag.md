# US-SCH-13 — Per-resource near-term utilisation flag

As an Editor, I want a near-term utilisation warning so that I can see over-capacity coming within the next 14 days.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- With Show Personal Utilisation on, a tracked resource’s row shows its utilisation percentage for the visible window.
- The percentage turns red and bold, with hover text beginning **Overbooked within the next 14 days**, when the resource is over capacity on any day in the 14 days from today.
- The red state depends only on that fixed 14-day window; changing the visible range changes the percentage, not the flag.

## User flow

```mermaid
flowchart TD
  A["Viewer checks a resource utilisation figure"]
  B["Over-capacity inside the next 14 days turns the figure red"]
  C["Zooming or panning does not change that near-term warning"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  Read["buildCapacitySection computes over for tracked rows"] --> Fixed["overSoon samples company Today through Today plus 13"]
  Read --> Window["applyVisibleUtilisation → resolveServerUtilisation reads visible server day figures"]
  Window --> Ratio["Sum allocated and available for positive-availability dates; zero when none"]
  Fixed --> Render["ResourceActions gates UtilisationCell by personal preference and tracked row"]
  Ratio --> Render
  Render -->|hidden or external| Omit["No utilisation cell"]
  Render -->|shown| Value["Render percent and fixed overSoon cue when true"]
```

Zoom and pan can change the visible date sample. Blocks-mode absence conflict markers use their own flag.

**Code references:**

- [capacity_section.ts](../../apps/backend/app/services/planning/capacity_section.ts#L84)
- [capacity_section.ts](../../apps/backend/app/services/planning/capacity_section.ts#L137)
- [schedulerRowCapacity.ts](../../apps/frontend/src/components/scheduler/schedulerRowCapacity.ts#L60)
- [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts#L98)
- [capacity.ts](../../packages/shared/src/lib/capacity.ts#L117)
- [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx#L91)
