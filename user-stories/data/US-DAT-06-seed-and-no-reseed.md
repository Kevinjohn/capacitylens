# US-DAT-06 — Seed on first run, never re-seed after clearing

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/data.spec.ts` → "seeds a demo dataset on first load"; the no-re-seed-after-in-app-clear behaviour is unit-covered (`src/data/persist.test.ts` → "does not re-seed after the user has cleared all their data")

## Goal
Get a populated demo dataset on a genuine first run (empty storage), and — critically — never have that demo data come back once the user has deliberately emptied the app.

## Why
A first-time user wants something to look at, so an empty browser gets the demo seed. But once someone clears the app to start their own real plan, resurrecting the demo on the next reload would be infuriating and could clobber intent. Seeding must therefore key off "has this app ever stored anything?", not "is the data currently empty?".

## How (end-to-end)
**Precondition:** A browser/profile where Floaty has never run (or one reset via DevTools → Console → `localStorage.clear()`).

**Scenario A — first run seeds:**
1. With storage empty (no `floaty/v3` key), open the app at `/`.
2. Observe the seeded demo dataset (Disciplines, Resources incl. *Tyler Nix* / *Senior Designer*, Clients *Acme Inc.* / *Globex*, etc.; Schedule bars in June 2026).

**Scenario B — clearing in-app does NOT re-seed:**
3. Delete every entity from *inside the app* (e.g. delete both clients — which cascades projects/tasks/allocations — then delete all resources, disciplines and any time off) until all lists are empty and the Schedule shows the empty state (`scheduler-empty`).
4. Do a **full page reload**.
5. Confirm the app comes back **empty**, not re-seeded.

**Contrast — only true reset re-seeds:**
6. Separately, open DevTools → Console → run `localStorage.clear()` (removes the `floaty/v3` key entirely) → reload. The seed returns (this is the genuine first-run path again).

## Acceptance criteria
- ✅ On a genuine first run (no `floaty/v3` key in `localStorage`), the app loads with the full demo seed.
- ✅ After deleting all entities **inside the app** and reloading, the app stays **empty** — the demo seed is **not** resurrected (deleting in-app leaves the storage key present, so bootstrap treats it as "existing", not first-run).
- ✅ Re-seeding only happens after a true reset that removes the storage key (`localStorage.clear()` in DevTools), which restores the first-run demo data.
