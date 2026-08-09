# US-TBR-01 — Zoom the timeline (1/2/4/6/8 weeks)

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "zooms the timeline and tracks the active level" · `e2e/scheduler.spec.ts` → "zooming to more weeks shrinks the day columns (same bar gets narrower)"

## Goal

Change how many weeks the timeline shows at once (1, 2, 4, 6 or 8), so the manager can trade detail for overview.

## Why

Some questions need a day-level view of this week; others need a two-month overview to spot clashes. One zoom control that fits a chosen number of weeks into the viewport serves both, and the day columns resize to fit.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`). (Do not pre-set **Weeks visible** — this story changes it.) Click **Today** so the seed bars are in view.

1. Open the **Weeks visible** dropdown and choose **1 week**. Note the width of a chosen bar (e.g. _Brand System_).
2. Open the **Weeks visible** dropdown and choose **8 weeks**.
3. Compare the same bar's width.

## Acceptance criteria

- ✅ **Weeks visible** is a dropdown (accessible name "Weeks visible") whose five options read **"1 week", "2 weeks", "4 weeks", "6 weeks", "8 weeks"**; choosing one sets that many weeks across the viewport.
- ✅ The closed trigger displays the current level in words (e.g. **"4 weeks"**).
- ✅ The same allocation bar is physically **narrower at 8 weeks than at 1 week** (day columns shrink to fit more weeks).
- ✅ Choosing a new level rescales the day columns and re-anchors the grid's **left edge to the week start** (see **US-TBR-08**); it does not change any other control or alter any allocation.
