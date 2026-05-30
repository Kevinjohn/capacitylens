# US-TBR-04 — Jump to a specific date

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "jumps to a chosen date" · `e2e/scheduler.spec.ts` → "jumping to a date moves the timeline to that month"

## Goal
Move the timeline to a specific date using the **Jump to date** picker.

## Why
The seed bars live in June 2026 and the grid opens centred on today, which may be elsewhere. A date picker lets the manager land directly on the month they care about instead of panning week by week.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). (Do not pre-set a jump — this story performs one.)
1. Set the **Jump to date** input to `2026-08-10`.

## Acceptance criteria
- ✅ The **Jump to date** input holds the chosen value (`2026-08-10`).
- ✅ The timeline scrolls/moves so that month is shown — the header reads **"Aug 2026"**.
- ✅ Jumping does not change the zoom level.
- ✅ (Sanity) Setting the date to `2026-06-01` brings the June seed bars into view.
