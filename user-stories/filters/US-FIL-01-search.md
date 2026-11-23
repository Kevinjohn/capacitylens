# US-FIL-01 — Search resources by name or role

As a company member, I want to search resources by name or role so that I can find the people I want to review.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Search people…** filters resource rows by resource name or role.
- Clearing the query restores the matching rows.

## User flow

```mermaid
flowchart TD
  N1["Enter a name or role in Schedule search"]
  N2["matching resources remain"]
  B1["No matches: see the empty state and clear filters"]
  B2["Clear the query: matching rows return"]
  N1 --> N2
  N1 -.-> B1
  N1 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  OPEN["Show filters mounts SchedulerToolbarFilters"] --> INPUT{"Search people input event"}
  INPUT -->|Paste would exceed 256 UTF-16 units| ERROR["rejectOverlongQueryPaste prevents paste and FieldError appears"]
  INPUT -->|Change accepted, including clear| DRAFT["useToolbarSearch.changeSearch updates draft, clears error and starts a 180 ms timer"]
  DRAFT --> TIMER{"Pending search outcome"}
  TIMER -->|Timer fires with same filter object| COMMIT["setFilters commits search"]
  TIMER -->|Another toolbar filter changes| BOTH["setToolbarFilters cancels timer and commits patch with draft search"]
  TIMER -->|Clear, external filter replacement or company change| CANCEL["Cancel pending search and reset draft from current filters"]
  COMMIT --> MATCH["createAllocationFilters.resourceVisible folds and matches name and job title"]
  BOTH --> MATCH
  MATCH --> ROWS["buildSchedulerModel retains matching eligible rows and drops empty groups"]
```

These controls use in-memory schedule filters for any role that can open Schedule, including Viewer and view-as-member. Clearing only the input keeps the other filter choices. The predicate folds the trimmed term and a combined string containing the display name, stored name and job title.

**Code references:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx#L221) · [localQueryInput.ts](../../apps/frontend/src/lib/localQueryInput.ts#L5) · [useToolbarSearch.ts](../../apps/frontend/src/components/scheduler/useToolbarSearch.ts#L22) · [schedulerModelFilters.ts](../../apps/frontend/src/components/scheduler/schedulerModelFilters.ts#L26) · [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts#L208) · [SchedulerToolbar.test.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.test.tsx#L552)
