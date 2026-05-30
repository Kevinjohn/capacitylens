# US-TBR-07 — Undo / Redo with ⌘Z / ⌘⇧Z

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "undoes and redoes with the keyboard and ignores the shortcut while typing"

## Goal
Undo with **⌘Z** and redo with **⌘⇧Z** from anywhere on the schedule, while the shortcut stays out of the way when the user is typing in a text field.

## Why
Power users expect the standard keyboard undo/redo. But those keys must not steal a user's in-field edit (e.g. fixing a typo in the search box should undo the *text*, not the last schedule change), so the global shortcut is suppressed while focus is in an input or textarea.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`.
1. Make one reversible edit — e.g. click a bar and **Delete** it.
2. Press **⌘Z**. Then press **⌘⇧Z**.
3. Click into the **Search people…** box, type a few characters, and with focus still in the box press **⌘Z**.
4. Click outside the box (blur it), then press **⌘Z** again.

## Acceptance criteria
- ✅ With focus outside any field, **⌘Z** undoes the last edit (the deleted bar returns) and **⌘⇧Z** redoes it (the bar disappears again).
- ✅ While focus is in the **Search people…** text input, **⌘Z** is ignored at the app level — it does not undo a schedule change (it acts on the field's text instead).
- ✅ The guard covers text **input** / **textarea** / contentEditable; after blurring the search box, **⌘Z** undoes app-level edits again.
