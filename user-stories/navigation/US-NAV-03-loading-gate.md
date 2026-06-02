# US-NAV-03 — Content is gated on hydration ("Loading…")

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked E2E:** manual (AppShell gates on `hydrated`) + unit (`src/components/AppShell.test.tsx` → "shows \"Loading…\" when the store is not hydrated")

## Goal
See a brief "Loading…" placeholder until data is read from `localStorage`, then the
real schedule — never a flash of empty lists or an empty grid.

## Why
Floaty reads everything from `localStorage` on startup. If the UI rendered before that
finished, a manager would see (and might panic at) an empty schedule that then pops
full of data. Gating the main content on a `hydrated` flag removes that flash entirely.

## How (end-to-end)
**Precondition:** Seeded app — close the tab, then re-open <http://localhost:5173>
(or hard-reload). To make the gate easy to observe, throttle DevTools (Network →
*Slow 3G* or CPU 6×) before reloading.
1. Reload the app and watch the main content area (right of the sidebar).
2. Observe a brief **Loading…** message in the content area while data is read.
   (The sidebar shell itself is always present.)
3. Once hydration completes, the **Schedule** grid renders with the seeded resources
   (e.g. *Tyler Nix* under **Design**) — running near the seed dates, the seed bars are
   visible; otherwise **Jump to date → 2026-06-01** to see them.

## Acceptance criteria
- ✅ Before hydration, the content area shows **Loading…** and no list/grid rows.
- ✅ The empty grid / empty list state never flashes before data arrives (no
  "0 resources" then a jump to the seeded rows).
- ✅ After hydration completes, the seeded schedule renders (the grid and its seeded
  resource rows are present).
- ✅ The sidebar (Floaty title + the eight links) is visible throughout, including
  during the loading phase.
