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

```mermaid
flowchart TD
  grid["SchedulerGrid renders AllocationBar"] --> label["buildAriaLabel describes bar and role"]
  label --> bar["AllocationBar receives keyboard event"]
  bar --> action["dispatchBarKeyboardAction"]
  action -->|Enter or Space| edit["onEdit opens AllocationModal when supplied"]
  action -->|arrow key| nudge["nudgeBarFromKeyboard calls nudge mode"]
  nudge --> gesture["useAllocationGesture applies move or resize"]
```

**Code references:** [AllocationBar.tsx](../../apps/frontend/src/components/scheduler/AllocationBar.tsx); [AllocationBarView.tsx](../../apps/frontend/src/components/scheduler/AllocationBarView.tsx); [useAllocationGesture.ts](../../apps/frontend/src/components/scheduler/useAllocationGesture.ts); [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)
