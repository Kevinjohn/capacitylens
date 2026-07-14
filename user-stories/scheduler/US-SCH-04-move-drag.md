# US-SCH-04 — Move an allocation by dragging its body

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "drags a bar to move it later"

## Goal
Shift an allocation earlier or later by dragging its body along the lane; the dates move by whole days (snap to the grid).

## Why
Plans slip. When a piece of work needs to start a few days later — or can be pulled forward — the manager wants to grab the bar and slide it, not re-open a form and re-type two dates. Snapping to whole days keeps the schedule clean (no half-day drift) and matches how capacity is reckoned per day.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Set zoom to **4w** and **Jump to date** → `2026-06-01` so the seed bars are in view.
1. Find the **Brand System** bar (the 9-day allocation on Brand Themes).
2. Note its current left edge (start) position.
3. Press down on the middle of the bar's body, drag right by roughly one day-column, and release.
4. The whole bar shifts right: both its start and end dates move later by one day, and the bar's left edge lands at a new x.

## Acceptance criteria
- ✅ Dragging the bar body ~1 column to the right shifts **both** start and end dates later by one whole day (snap — no fractional-day positions).
- ✅ After the drag, the bar's left edge is at a measurably greater x than before.
- ✅ The bar stays in the same resource's lane (a body drag along the lane moves dates, not the assignee — reassignment is US-SCH-06).
