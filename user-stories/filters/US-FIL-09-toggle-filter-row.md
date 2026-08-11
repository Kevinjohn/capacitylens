# US-FIL-09 — Show or hide the schedule filters

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "shows and hides the secondary filter row beside the schedule title"

## Goal

Keep the schedule compact until its filters or draw-mode control are needed.

## Why

The full filter row earns its space when many resources or projects are in play, but it otherwise
pushes the schedule down without helping. A clear toggle keeps every control close without making
the expanded row permanent.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`).

1. Confirm the button beside **Schedule** reads **Show filters** and the filter row is absent.
2. Click **Show filters**.
3. Confirm the row appears and includes **Work** / **Time off** plus the existing filter controls.
4. Click **Hide filters**.

## Acceptance criteria

- ✅ The filter-icon button sits beside the **Schedule** heading, reads **Show filters** while
  collapsed and **Hide filters** while expanded, and exposes the same state through `aria-expanded`.
- ✅ The row is collapsed by default; opening it moves the schedule down and reveals the existing
  controls without resetting them.
- ✅ The **Work** / **Time off** draw-mode radiogroup lives in the expanded row; **Undo** and **Redo**
  remain in the primary toolbar.
- ✅ Hiding the row removes its controls from keyboard and assistive-technology navigation.
