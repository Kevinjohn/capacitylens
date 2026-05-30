# US-SCH-12 — A vertical line marks today

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "shows the today line when today is in range and hides it when panned away"

## Goal
A vertical line marks today's date on the timeline whenever today falls within the currently visible range — and it's absent when you've panned to a range that doesn't include today.

## Why
"Where are we now?" is the question every other reading on the schedule hangs off — what's late, what's imminent, what's still ahead. A persistent today line gives the manager a fixed reference point so past and future read at a glance. Showing it only when today is actually on-screen keeps it honest: a line on a month that doesn't contain today would be a lie.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). The app auto-scrolls to today on load.
1. With the timeline showing the range around today, observe a vertical line marking today's column.
2. Use **Jump to date** / **Next ›** to pan to a range that does **not** contain today (e.g. jump well into a future month).
3. Observe the today line is no longer drawn — there's no spurious line on a range that doesn't include today.
4. Pan back so today is in range again (e.g. click **Today**) — the line reappears.

## Acceptance criteria
- ✅ When today is within the visible range, a vertical **today line** is drawn at today's column.
- ✅ When the visible range does **not** include today, the today line is **absent** (not drawn).
- ✅ Returning to a range that includes today (e.g. **Today**) brings the line back.
