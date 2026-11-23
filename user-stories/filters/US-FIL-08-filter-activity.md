# US-FIL-08 — Filter by activity (the activity lens)

As a company member, I want an activity lens across projects so that I can review internal or All projects work by activity.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Filter by activity** offers **All activities**, then an **Internal** group (**Internal — All**, then internal activities by name) and an **All projects** group (**All projects — All**, then all-projects activities by name). Project-specific activities are not listed; they are reached through **Filter by project**.
- Choosing **Internal — All** or **All projects — All** shows only work on activities of that kind; choosing one activity shows only its work.
- The activity lens and the client/project lens are exclusive: choosing an activity resets **Filter by client** and **Filter by project** to All, and choosing a client or project resets **Filter by activity** to **All activities**.
- **Show unallocated** works under the activity lens. The dropdown is absent when the company has no internal or all-projects activities and no activity lens is selected.

## User flow

```mermaid
flowchart TD
  N1["Choose an activity lens"]
  N2["matching activity bars remain across projects"]
  N3["clear the lens to restore all activities"]
  N1 --> N2
  N2 --> N3
```

## Code flow

```mermaid
flowchart TD
  OPT["buildFilterOptions supplies active Internal and All projects activities"] --> READY{"EntityFilters has an eligible activity or a retained selection?"}
  READY -->|No| HIDDEN["Omit Filter by activity"]
  READY -->|Yes| PICK{"ToolbarActivityFilter resolves current kind or id?"}
  PICK -->|Unavailable| DISABLED["Keep disabled Unavailable activity visible until selection changes"]
  PICK -->|Available or no selection| SELECT["Choose kind, activity id or All activities"]
  DISABLED --> SELECT
  SELECT --> PATCH["buildActivityFilterPatch → setToolbarFilters → setFilters"]
  PATCH --> LENS{"applyFilterPatch receives a concrete kind or id?"}
  LENS -->|Yes| MATCH["Clear client and project and match selected kind or id in allocVisible"]
  LENS -->|No| CLEAR["Clear activity lens and keep any current client or project lens"]
  MATCH --> ROWS["createRowBuilder and buildSchedulerModel retain matches and apply Show unallocated"]
  CLEAR --> ROWS
```

These controls use in-memory schedule filters for any role that can open Schedule, including Viewer and view-as-member. The picker omits project-specific activities. A missing individual id cannot match a renderable bar. A retained kind still runs the kind predicate. Selecting a concrete client or project clears either activity selection.

**Code references:** [toolbarFilterOptions.ts](../../apps/frontend/src/components/scheduler/toolbarFilterOptions.ts#L16) · [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx#L111) · [ToolbarActivityFilter.tsx](../../apps/frontend/src/components/scheduler/ToolbarActivityFilter.tsx#L25) · [ToolbarActivityFilter.tsx](../../apps/frontend/src/components/scheduler/ToolbarActivityFilter.tsx#L49) · [useToolbarSearch.ts](../../apps/frontend/src/components/scheduler/useToolbarSearch.ts#L47) · [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts#L80) · [schedulerModelFilters.ts](../../apps/frontend/src/components/scheduler/schedulerModelFilters.ts#L31) · [schedulerRowModel.ts](../../apps/frontend/src/components/scheduler/schedulerRowModel.ts#L164) · [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts#L208) · [ToolbarActivityFilter.test.tsx](../../apps/frontend/src/components/scheduler/ToolbarActivityFilter.test.tsx#L91)
