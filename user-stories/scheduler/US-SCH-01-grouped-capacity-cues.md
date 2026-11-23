# US-SCH-01 — Resources grouped by discipline, with capacity cues

As an Editor, I want resources grouped by discipline with capacity cues so that I can spot workload and availability while planning.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- With disciplines enabled, the Schedule groups resources by discipline, with people who have none under **Unassigned**; otherwise they appear under **Resources**. Either fallback splits into **Studio** and **Supplementary** when an active Supplementary person exists, and external parties appear under **External party**.
- With Show Personal Utilisation on, each tracked resource’s row shows its utilisation for the visible window.
- Over-capacity and unavailable days are visibly marked.

## User flow

```mermaid
flowchart TD
  A["Viewer opens Schedule"]
  B["Resources appear under discipline headings"]
  C["Capacity cues show utilisation, availability and over-capacity"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  Read["readPlanning authorizes and returns active projected data plus capacity"] --> Grid["useSchedulerGridPreferences reads scoped data and company settings"]
  Grid --> Group["buildSchedulerModel → buildResourceGroups"]
  Group -->|disciplines enabled| Discipline["Discipline and fallback groups"]
  Group -->|disciplines disabled| Engagement["Staffing or default grouping"]
  Discipline --> Filter["Apply feature visibility and row filters; omit empty groups"]
  Engagement --> Filter
  Filter --> View["applyVisibleUtilisation samples current visible dates"]
  View --> Row["SchedulerGridRow renders utilisation cues and ResourceLane day cues"]
```

Supplementary people can introduce staffing subgroups. Placeholder and External visibility apply independently. An empty projected schedule can offer Clear filters or a Resources action depending on filter and edit state.

**Code references:**

- [planning.ts](../../apps/backend/app/services/planning.ts#L96)
- [useSchedulerGridModel.ts](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts#L102)
- [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts#L132)
- [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts#L208)
- [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx#L130)
- [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx#L167)
