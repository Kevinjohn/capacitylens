# US-TBR-06 — Undo / Redo via toolbar buttons

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "undoes and redoes an edit with the toolbar buttons and disables at the ends of history"

## Goal
Reverse and re-apply edits with the toolbar **↶** (Undo) and **↷** (Redo) buttons, with the buttons disabling when there is nothing to undo or redo.

## Why
Scheduling is fast and mistake-prone (a stray drag, a wrong delete). Visible Undo/Redo controls give the manager confidence to experiment, and disabling them at history's ends signals when there is nothing left to reverse.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. The **Redo** (↷) button is disabled on load (nothing has been undone yet).
1. Make one edit you can reverse — e.g. click a bar and **Delete** it.
2. Click **Undo** (↶, title `Undo (⌘Z)`).
3. Click **Redo** (↷, title `Redo (⌘⇧Z)`).
4. Click **Undo** again, then keep clicking until your edits are exhausted.

## Acceptance criteria
- ✅ On load, **Redo** (↷) is disabled (empty redo history).
- ✅ After the delete, **Undo** (↶) is enabled; clicking it restores the deleted bar.
- ✅ After undoing, **Redo** (↷) is enabled; clicking it re-applies the delete (the bar disappears again).
- ✅ Once you have undone back through all of your own edits, **Undo** (↶) becomes disabled.
- ✅ The Undo/Redo icon buttons carry the accessible labels **Undo** / **Redo** and titles **`Undo (⌘Z)`** / **`Redo (⌘⇧Z)`**.
