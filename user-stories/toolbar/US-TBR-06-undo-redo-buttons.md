# US-TBR-06 — No undo/redo toolbar buttons (keyboard-only)

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "undoes/redoes with the keyboard and ignores the shortcut while typing"

## Goal
Confirm the scheduler toolbar intentionally has **no** Undo/Redo buttons — undo/redo lives on the keyboard (**⌘Z** / **⌘⇧Z**), as covered by US-TBR-07.

## Why
Earlier the toolbar carried **↶** / **↷** icon buttons. They were removed to keep the toolbar focused; the standard keyboard shortcuts are the single, discoverable way to reverse and re-apply edits, so the manager isn't offered two parallel controls for the same action.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`.
1. Scan the toolbar (the **Schedule** heading row and the row of `Prev` / `Today` / `Next` / zoom / draw-mode controls).
2. Make one reversible edit — e.g. click a bar and **Delete** it — then press **⌘Z**, then **⌘⇧Z**.

## Acceptance criteria
- ✅ The toolbar shows **no** Undo or Redo button — there is no **↶** / **↷** control, and no button with the accessible name **Undo** or **Redo**.
- ✅ Undo/redo still work from the keyboard: after a delete, **⌘Z** restores the bar and **⌘⇧Z** re-applies the delete (full keyboard behaviour and the typing guard are covered by **US-TBR-07**).
- ✅ Removing the buttons changed only the toolbar's controls; it did not alter any allocation or the undo history itself.
