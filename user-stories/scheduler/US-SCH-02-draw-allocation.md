# US-SCH-02 — Draw a new allocation across empty lane space

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "draws a new allocation on an empty part of a lane"

**Documentation:** [Make your first booking](../../docs-src/getting-started/quick-start.md#first-booking)

## Goal

Book a new allocation by dragging across an empty stretch of a resource's lane, or by
selecting one empty cell for a one-day booking. The "New allocation" modal opens already
prefilled with the selected date range.

## Why

The fastest way to plan is to "paint" time directly on the timeline where you want it. Drawing
the range first — or selecting one cell for a one-day booking — keeps the booking in the place
the manager is already looking, rather than re-typing dates into a form.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`). Set **Weeks visible** to **4 weeks** and click **Today** so the seed bars are in view. Make sure the draw-mode toggle is on **Work** (the default).

1. Scroll the timeline fully to the left so the start of the visible range is at the left edge (the precise drawn position only needs to land on empty lane space).
2. On an empty stretch of a resource's lane, press the mouse button down, drag right across roughly two day-columns, and release.
3. A **"New allocation"** modal opens, prefilled with the date range you drew.
4. Pick **Project** = _Project Watchtower_ and **Activity** = _Wireframes_.
5. Click **Save**. The modal closes and a new bar appears spanning the days you drew.
6. Select one empty cell without dragging. A **"New allocation"** modal opens with that single
   day as the date range.

## Acceptance criteria

- ✅ A real drag across empty lane space opens the **"New allocation"** modal (`role="dialog"`) prefilled with the drawn date range.
- ✅ A single click on an empty cell opens the same modal prefilled for that one day.
- ✅ After choosing a project + activity and clicking **Save**, a new **allocation-bar** appears spanning the drawn days (one more bar than before).
- ✅ Saving a one-day selection creates one allocation bar covering that cell's date.
