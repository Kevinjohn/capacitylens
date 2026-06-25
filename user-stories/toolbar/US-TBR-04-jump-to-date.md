# US-TBR-04 — Jump to a specific date

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "jumps to a chosen date" · `e2e/scheduler.spec.ts` → "jumping to a date moves the timeline to that month"

## Goal
Move the timeline to a specific date using the **Jump to date** picker.

## Why
The seed bars live in June 2026 and the grid opens centred on today, which may be elsewhere. A date picker lets the manager land directly on the month they care about instead of panning week by week.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). (Do not pre-set a jump — this story performs one.)
1. Set the **Jump to date** input to `2026-09-10` (a Thursday).

## Acceptance criteria
- ✅ The timeline scrolls/moves so that month is shown — the header reads **"Sep 2026"**.
- ✅ The picker **re-anchors the grid's left edge to the week start** (account `weekStartsOn`, default Monday): the **Jump to date** input snaps to and holds that week's Monday, **`2026-09-07`** (not the Thursday you typed). The grid's leftmost column is that Monday.
- ✅ Jumping does not change the zoom level.
- ✅ (Sanity) Setting the date to `2026-06-01` (already a Monday) brings the June seed bars into view and the input keeps `2026-06-01`.

> See **US-TBR-08** for the same week-start re-anchoring on zoom and Prev/Next.
