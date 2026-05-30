# US-TBR-02 — Pan a week back / forward

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "pans the window one week with Prev and Next"

## Goal
Move the visible window one week earlier or later with the ‹ Prev / Next › buttons.

## Why
Once zoomed in, the manager steps through the calendar a week at a time to review upcoming work without losing the zoom level or scroll context.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. Note the dates shown in the timeline header.
1. Click **Next ›**. Observe the header dates.
2. Click **‹ Prev** twice. Observe the header dates.

## Acceptance criteria
- ✅ Clicking **Next ›** shifts the visible window so the header dates move **7 days later**.
- ✅ Clicking **‹ Prev** shifts the window so the header dates move **7 days earlier**.
- ✅ After Next then two Prev, the window sits one week earlier than the starting position (each click is exactly one week, and they compose).
- ✅ Panning does not change the zoom level (still 4w) or alter any allocation.
