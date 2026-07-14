# US-TBR-03 — Re-centre on Today

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "re-centres on Today after scrolling away" · `e2e/scheduler.spec.ts` → "clicking Today re-centres the timeline after scrolling away"

## Goal
Jump the timeline back to today after scrolling or panning far away.

## Why
After exploring future or past weeks, the manager wants a one-click way home to "now" — the most common reference point — without manually scrolling back.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`.
1. Scroll the schedule grid far to the right (or pan several weeks forward) so today is well off-screen.
2. Click **Today**.

## Acceptance criteria
- ✅ Before clicking, the grid is scrolled a long way from today (large horizontal scroll offset).
- ✅ After clicking **Today**, the timeline re-scrolls back so today is near the visible window (the scroll offset drops sharply toward the start).
- ✅ **Today** does not change the zoom level.
