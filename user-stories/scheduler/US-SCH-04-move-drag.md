# US-SCH-04 — Move an allocation by dragging its body

As an Editor, I want to drag an allocation along its lane so that I can change its dates without changing its assignee.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Dragging an allocation body moves it by whole days on the same resource. Unless Ignore working days is set, a moved start that falls on a non-working day moves on to the next working day in the drag direction, and the allocation keeps its working-day length.
- The resulting bar shows the updated dates.

## User flow

```mermaid
flowchart TD
  A["Editor drags an allocation body along its lane"]
  B["The bar previews its snapped date range"]
  C["Release saves the updated dates; a refusal leaves the booking unchanged"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  Bar["Editable Work-mode AllocationBar arms useDragResize on its body"] --> Gesture["useAllocationGestureViewModel previews the move"]
  Gesture -->|release below drag threshold| Edit["onEdit opens allocation dialog"]
  Gesture -->|Escape, pointer cancel or lost capture| Cancel["Clear preview and release gesture"]
  Gesture -->|drag release| Hit["commitPointerGesture repeats hit test"]
  Hit -->|same row or no other hit and zero delta| Cancel
  Hit -->|different resource| Reassign["Follow allocation.reassign path"]
  Hit -->|same-row move| Dates["resolveCommitDates moves whole-day span and preserves load"]
  Dates --> Diff["savePointerCommit → updateAllocation"]
  Diff -->|unchanged| Cancel
  Diff -->|changes| Commit["commit checks live access and revision; allocation.update writes dates"]
  Commit -->|committed and reconciled| Done["Show move notice and any receipt advisory"]
  Commit -->|refused| Error["Show refusal; stale revision can trigger canonical read"]
  Commit -->|lost or invalid reply| Unknown["Canonical read can show saved position; no replay"]
```

The slide math uses literal calendar movement for Ignore working days or zero measured duration. The same-row branch keeps the assignee and its existing placement exceptions. [US-SCH-06](US-SCH-06-reassign-drag.md) owns the cross-row branch.

**Code references:**

- [AllocationBar.tsx](../../apps/frontend/src/components/scheduler/AllocationBar.tsx#L193)
- [useDragResize.ts](../../apps/frontend/src/hooks/useDragResize.ts#L99)
- [useDragResize.ts](../../apps/frontend/src/hooks/useDragResize.ts#L126)
- [useAllocationGestureViewModel.ts](../../apps/frontend/src/components/scheduler/useAllocationGestureViewModel.ts#L200)
- [useAllocationGestureViewModel.ts](../../apps/frontend/src/components/scheduler/useAllocationGestureViewModel.ts#L240)
- [useAllocationGestureViewModel.ts](../../apps/frontend/src/components/scheduler/useAllocationGestureViewModel.ts#L374)
- [allocationDrag.ts](../../apps/frontend/src/components/scheduler/allocationDrag.ts#L40)
- [gestureMath.ts](../../apps/frontend/src/lib/gestureMath.ts#L110)
- [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts#L138)
- [planning_execution_service.ts](../../apps/backend/app/services/planning/planning_execution_service.ts#L182)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L9)
- [planning_service.ts](../../apps/backend/app/services/planning_service.ts#L222)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
