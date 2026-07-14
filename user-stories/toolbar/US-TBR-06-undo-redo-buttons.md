# US-TBR-06 — Undo / Redo toolbar buttons

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "undoes and redoes with the toolbar buttons, disabled when the stack is empty"

## Goal
Reverse and re-apply the last schedule edit straight from the toolbar — a visible **Undo** / **Redo** pair the manager can see and click, with no need to know the keyboard shortcut.

## Why
The keyboard path (**⌘Z** / **⌘⇧Z**, see US-TBR-07) is fast for power users but invisible — a new manager has no way to discover it. Surfacing Undo/Redo as toolbar buttons makes "I can take that back" obvious, and their disabled state doubles as a cue for whether there's anything to undo or redo. The shortcut still works; the buttons are its visible counterpart, not a replacement.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`.
1. Scan the toolbar — to the right of the draw-mode toggle, find the **Undo** and **Redo** icon buttons.
2. On a fresh load (account just picked, empty history) note both buttons look inactive.
3. Make one reversible edit — click the **Brand System** bar and **Delete** it.
4. Click the **Undo** button.
5. Click the **Redo** button.

## Acceptance criteria
- ✅ The toolbar shows **Undo** and **Redo** icon buttons — `data-testid` `undo-button` / `redo-button`, with accessible names (aria-label) **Undo** and **Redo**, and a `title` carrying the shortcut hint (**Undo (⌘Z)** / **Redo (⌘⇧Z)**).
- ✅ On a fresh load (nothing done yet) **both** buttons are **disabled** — there is nothing to undo or redo.
- ✅ After a reversible edit (delete the **Brand System** bar, total `allocation-bar` count drops by one) the **Undo** button becomes **enabled**.
- ✅ Clicking **Undo** restores the exact bar (count returns to the original) and **enables** the **Redo** button.
- ✅ Clicking **Redo** re-applies the delete (count drops by one again).
- ✅ The global **⌘Z** / **⌘⇧Z** shortcut still performs the same undo/redo and is ignored while typing in a text field — that keyboard path and its typing guard are covered by **US-TBR-07**.
