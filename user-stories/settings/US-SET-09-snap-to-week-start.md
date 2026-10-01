# US-SET-09 — Snap the schedule's left edge to the week start

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:** `e2e/snap-week.spec.ts` → "a stray scroll nudge snaps back to the week start", "the snap FLOORS to the current week (not NEAREST), even past the half-week", "with the test override OFF, the nudge sticks (and so proves the nudge moves off Monday)"

**Documentation:** [The schedule](../../docs-src/guide/the-schedule.md)

## Goal

Keep the first day of the week pinned to the left edge of the schedule: after a free horizontal scroll settles, floor the leftmost column back to the current week's Monday — so a stray trackpad nudge can't leave the helicopter view parked awkwardly on a Tue/Wed.

## Why

At a fine zoom the grid scrolls horizontally pixel-by-pixel, and a small accidental scroll
leaves the left edge on a mid-week day — the week boundaries no longer line up with the left
edge and the view reads as "off by a couple of days". Flooring back to the week start on idle
keeps every free view tidy without fighting a deliberate scroll while it's in progress. CapacityLens
is a week-granularity scheduler, so this is always on and Settings has no switch for it. It floors
only (never forward): deliberately moving to a later week is what Prev/Next and **Weeks visible**
are for, and those — the always-on navigation snap — already land on a week start.

## How (end-to-end)

**Precondition:** Seeded app open on the Schedule (clock inside the seed window — see _Seed data_ in REFERENCE.md), at a fine zoom (e.g. **1 week** on **Weeks visible**) so per-day columns show. The view opens with the left edge flush on the current week's Monday.

1. On the Schedule, note the leftmost date-header column reads a weekday label of **Mon** (default `weekStartsOn`).
2. Nudge the schedule a couple of day-columns to the right (a small horizontal scroll) so the left edge would sit on a Wed/Thu, then stop scrolling.
3. After a moment (the scroll settles), the left edge **floors back to Monday** — the same week's start, never a forward week.
4. Open **Settings**: there is no week-snap switch.

## Acceptance criteria

- After a free horizontal scroll settles, the grid's left edge floors to the current left-edge day's week start (the account `weekStartsOn`, default Monday). It floors only — a nudge never advances to a later week.
- Settings has no control for it, and nothing is stored on the account or included in Export JSON.
- This governs **free scroll only**. The navigation snap (a **Weeks visible** choice, Prev/Next pan, **Today**) re-anchors the left edge to the week start on every deliberate navigation (see US-TBR-08).
- A drag in progress is never fought: the floor-snap respects the drag-freeze (it doesn't fire while a bar is being dragged), and it converges in one step (a programmatic scroll that already sits on a week start is a no-op, so there's no feedback loop).
- Browser tests may store `off` under the test-only `localStorage` key `capacitylens/snapToWeekStart` before the app loads; a nudge onto a Tue/Wed then stays there. This is not a user-facing preference.
