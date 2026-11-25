# US-KBD-01 — Operate schedule allocations by keyboard

As a keyboard-only scheduler, I want to focus, move, resize, and open allocation bars by keyboard so that I can manage work without dragging.

**Status:** Current

**Access:** Owner, Admin, Editor; Viewer is read-only

**Entry:** Schedule allocation bar keyboard focus and arrow keys

**Documentation:** [Read The Schedule](../../docs-src/using/read-the-schedule.md)

**Source:** [AllocationBar.tsx](../../apps/frontend/src/components/scheduler/AllocationBar.tsx)

## Acceptance criteria

- Focused bars have an accessible name; Enter opens editing when permitted and arrow-key commands move or resize as available.

## User flow

```mermaid
flowchart TD
  focus["Focus an allocation bar"] --> name["Hear its accessible name"]
  name --> edit["Enter opens editing when permitted"]
  name --> move["Arrow keys move the bar"]
  name --> resize["Alt/Shift plus arrow resizes"]
  focus -->|Viewer| inspect["Read-only bar remains inspectable"]
```

## Code flow

The allocation mutation and server checks are traced in [US-ALL-02](../allocation/US-ALL-02-edit.md#code-flow). The keyboard path uses the live store action after gesture checks, without the edit dialog’s draft check.

```mermaid
flowchart TD
  lane["ResourceLane BarsLayer renders AllocationBar and makes the layer inert in Time off mode"] --> bar["Work mode: AllocationBar handles keydown"]
  bar --> repeat{"Repeated keydown?"}
  repeat -->|yes| ignore["Leave the bar unchanged"]
  repeat -->|no| escape{"Escape with open popover and no drag?"}
  escape -->|yes| hide["closePopoverOnEscape hides the popover"]
  escape -->|no| edit{"useCanEdit allows editing?"}
  edit -->|no| ignore
  edit -->|Enter or Space| open["activateBarFromKeyboard calls onEdit with allocation ID when supplied"]
  edit -->|Left or Right without Ctrl or Meta| nudge["nudgeBarFromKeyboard calls nudge with move, Alt start resize or Shift end resize"]
  nudge --> calc{"nudgeAllocation finds a valid changed span?"}
  calc -->|no| skip["Blocked or unchanged gesture sends no write"]
  calc -->|yes| save["saveKeyboardGesture calls updateAllocation"]
  save -->|changed| focus["Schedule focus restoration; announce capacity only if the read settled"]
  save -->|refused or unconfirmed| failure["Surface applicable error or planning recovery"]
```

**Code references:** [ResourceLane.tsx:34](../../apps/frontend/src/components/scheduler/ResourceLane.tsx#L34) · [AllocationBar.tsx:20](../../apps/frontend/src/components/scheduler/AllocationBar.tsx#L20) · [AllocationBar.tsx:96](../../apps/frontend/src/components/scheduler/AllocationBar.tsx#L96) · [AllocationBar.tsx:136](../../apps/frontend/src/components/scheduler/AllocationBar.tsx#L136) · [useAllocationGesture.ts:454](../../apps/frontend/src/components/scheduler/useAllocationGesture.ts#L454) · [useAllocationGesture.ts:362](../../apps/frontend/src/components/scheduler/useAllocationGesture.ts#L362) · [useAllocationGesture.ts:398](../../apps/frontend/src/components/scheduler/useAllocationGesture.ts#L398)
