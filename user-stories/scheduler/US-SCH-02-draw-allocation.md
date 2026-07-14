# US-SCH-02 — Draw a new allocation across empty lane space

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "draws a new allocation on an empty part of a lane"

## Goal
Book a new allocation by dragging across an empty stretch of a resource's lane; a "New allocation" modal opens already prefilled with the drawn date range.

## Why
The fastest way to plan is to "paint" time directly on the timeline where you want it. Drawing the range first — then just choosing the project and activity — keeps the booking in the place the manager is already looking, rather than re-typing dates into a form. Requiring a real drag (not a stray click) means an accidental tap never pops a modal.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Set zoom to **4w** and **Jump to date** → `2026-06-01`. Make sure the draw-mode toggle is on **Work** (the default).
1. Scroll the timeline fully to the left so the start of the visible range is at the left edge (the precise drawn position only needs to land on empty lane space).
2. On an empty stretch of a resource's lane, press the mouse button down, drag right across roughly two day-columns, and release.
3. A **"New allocation"** modal opens, prefilled with the date range you drew.
4. Pick **Project** = *Project Lightning* and **Activity** = *Wireframes*.
5. Click **Save**. The modal closes and a new bar appears spanning the days you drew.
6. Now test the negative case: do a bare single click on empty lane space (press and release without dragging). Nothing happens.

## Acceptance criteria
- ✅ A real drag across empty lane space opens the **"New allocation"** modal (`role="dialog"`) prefilled with the drawn date range.
- ✅ After choosing a project + activity and clicking **Save**, a new **allocation-bar** appears spanning the drawn days (one more bar than before).
- ✅ A bare click (no drag) on empty lane space does **not** open the modal and creates nothing.
