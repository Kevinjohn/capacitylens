# US-SCH-06 — Reassign an allocation onto another resource

As an Editor, I want to drag an allocation onto another resource so that I can reassign work on the Schedule.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Dragging an allocation to another resource reassigns it when valid.
- The bar appears on the destination resource row.

## User flow

```mermaid
flowchart TD
  A["Editor drags a booking onto another resource"]
  B["The bar previews the destination and dates"]
  C["Release attempts one reassignment"]
  D["Save succeeds: the booking moves"]
  E["Save is rejected: the original booking remains"]
  A --> B
  B --> C
  C --> D
  C --> E
```

## Code flow

```mermaid
flowchart TD
  Bar["Editable Work-mode AllocationBar starts a body move"] --> Preview["previewGesture tests destination lane and provides a visual preview"]
  Preview -->|cancel or lost capture| None["Clear gesture without write"]
  Preview -->|click or source-row drop| Other["Click-to-edit or same-row movement"]
  Preview -->|different resource at final hit test| Dates["commitPointerGesture resolves proposed dates for target calendar"]
  Dates -->|calendar preflight fails| Notice["Show working-day drop error; no request"]
  Dates -->|accepted| Send["savePointerCommit → reassignAllocation sends allocation.reassign"]
  Send --> Commit["commit checks live access and revision; executePlanningIntent reconciles target load"]
  Commit --> Verify["writeEntity checks target assignment, working day and availability"]
  Verify -->|committed and reconciled| Done["Show reassignment notice and any advisory"]
  Commit -->|known refusal| Error["Show refusal; no horizontal-only fallback"]
  Commit -->|lost or invalid reply| Unknown["Canonical read can show complete reassignment; no replay"]
```

A zero-column drop can still reassign. It offers the original start and re-places the measured source duration against the target calendar before the drop check.

**Code references:**

- [AllocationBar.tsx](../../apps/frontend/src/components/scheduler/AllocationBar.tsx#L193)
- [useDragResize.ts](../../apps/frontend/src/hooks/useDragResize.ts#L126)
- [useAllocationGestureViewModel.ts](../../apps/frontend/src/components/scheduler/useAllocationGestureViewModel.ts#L131)
- [useAllocationGestureViewModel.ts](../../apps/frontend/src/components/scheduler/useAllocationGestureViewModel.ts#L200)
- [useAllocationGestureViewModel.ts](../../apps/frontend/src/components/scheduler/useAllocationGestureViewModel.ts#L240)
- [gestureMath.ts](../../apps/frontend/src/lib/gestureMath.ts#L110)
- [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts#L154)
- [execute.ts](../../apps/backend/app/services/planning/execute.ts#L220)
- [domain.ts](../../apps/backend/app/services/planning/entity_validation/domain.ts#L200)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L9)
- [planning.ts](../../apps/backend/app/services/planning.ts#L198)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
- [AllocationBar.pointerDrag.interaction.test.tsx](../../apps/frontend/src/components/scheduler/AllocationBar.pointerDrag.interaction.test.tsx#L202)
