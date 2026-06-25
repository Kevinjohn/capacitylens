# US-SET-09 — Snap the schedule's left edge to the week start

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:** `e2e/snap-week.spec.ts` → "the setting is on by default and persists across reload", "with the setting ON, a stray scroll nudge snaps back to the week start", "with the setting OFF, the nudge sticks (and so proves the nudge moves off Monday)"

## Goal
Keep the first day of the week pinned to the left edge of the schedule: after a free horizontal scroll settles, floor the leftmost column back to the current week's Monday — so a stray trackpad nudge can't leave the helicopter view parked awkwardly on a Tue/Wed.

## Why
At a fine zoom the grid scrolls horizontally pixel-by-pixel, and a small accidental scroll
leaves the left edge on a mid-week day — the week boundaries no longer line up with the left
edge and the view reads as "off by a couple of days". Flooring back to the week start on idle
keeps every free view tidy without fighting a deliberate scroll while it's in progress. It's a
per-browser viewing choice (like the theme and *Minimise weekends*), not shared account data, so
each person sets it to taste. It defaults **on** — the common case. It floors only (never forward):
deliberately moving to a later week is what Prev/Next and the date picker are for, and those —
the always-on navigation snap — already land on a week start regardless of this switch.

## How (end-to-end)
**Precondition:** Seeded app open on the Schedule (clock inside the seed window — see *Seed data* in REFERENCE.md), at a fine zoom (e.g. **1w**) so per-day columns show. The view opens with the left edge flush on the current week's Monday.

1. On the Schedule, note the leftmost date-header column reads a weekday label of **Mon** (default `weekStartsOn`).
2. Nudge the schedule a couple of day-columns to the right (a small horizontal scroll) so the left edge would sit on a Wed/Thu, then stop scrolling.
3. After a moment (the scroll settles), the left edge **floors back to Monday** — the same week's start, never a forward week.
4. Open **Settings** (sidebar). In the **Schedule** section, find the **Snap to week start** switch — it's **on**, below **Minimise weekends**.
5. Switch it **off**, return to **Schedule**, and nudge again the same way: this time the left edge **stays** on the mid-week day.
6. (Optional) Reload the page and re-pick **Studio North**: the choice is remembered.

## Acceptance criteria
- The **Schedule** section in Settings has a second switch **Snap to week start** (`role="switch"`, accessible name `Snap to week start`), directly below **Minimise weekends**.
- The switch defaults to **on** (`aria-checked="true"`).
- With it on: after a free horizontal scroll settles, the grid's left edge floors to the current left-edge day's week start (the account `weekStartsOn`, default Monday). It floors only — a nudge never advances to a later week.
- With it off: free scrolling is unconstrained — a nudge onto a Tue/Wed stays there.
- This governs **free scroll only**. The navigation snap (zoom click, Prev/Next pan, date picker) re-anchors the left edge to the week start regardless of this switch (see US-SET — Scheduler toolbar / Feature 1).
- A drag in progress is never fought: the floor-snap respects the drag-freeze (it doesn't fire while a bar is being dragged), and it converges in one step (a programmatic scroll that already sits on a week start is a no-op, so there's no feedback loop).
- The choice survives a reload in the same browser (device-global `capacitylens/snapToWeekStart`), is **not** on the account, and is **not** included in Export JSON.
