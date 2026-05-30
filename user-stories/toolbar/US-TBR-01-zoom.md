# US-TBR-01 — Zoom the timeline (1/2/4/6/8 weeks)

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "zooms the timeline and resizes the day columns" · `e2e/scheduler.spec.ts` → "zooming to more weeks shrinks the day columns (same bar gets narrower)"

## Goal
Change how many weeks the timeline shows at once (1, 2, 4, 6 or 8), so the manager can trade detail for overview.

## Why
Some questions need a day-level view of this week; others need a two-month overview to spot clashes. One zoom control that fits a chosen number of weeks into the viewport serves both, and the day columns resize to fit.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). (Do not pre-set a zoom — this story changes it.) The seed bars live in June 2026; **Jump to date** → `2026-06-01` to keep one in view.
1. Click **1w**. Note the width of a chosen bar (e.g. *Brand System*).
2. Click **8w**.
3. Compare the same bar's width.

## Acceptance criteria
- ✅ The zoom buttons are `1w` / `2w` / `4w` / `6w` / `8w`; clicking one sets that many weeks across the viewport.
- ✅ The clicked button has `aria-pressed="true"`; all other zoom buttons have `aria-pressed="false"`.
- ✅ The same allocation bar is physically **narrower at 8w than at 1w** (day columns shrink to fit more weeks).
- ✅ Switching zoom rescales the day columns without re-centring; it does not change the zoom of any other control or alter any allocation.
