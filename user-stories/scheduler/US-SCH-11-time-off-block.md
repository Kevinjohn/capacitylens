# US-SCH-11 — Time off renders as a labelled hatched block

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/features.spec.ts` → "booking time off greys the schedule"

## Goal
A resource's time off shows on the timeline as a distinct hatched block, labelled with the reason, so it reads clearly as "away" and not as a piece of work.

## Why
Time off and allocations both occupy a person's days, but they mean opposite things — one is capacity *removed*, the other capacity *used*. A hatched, labelled block makes the absence unmistakable (you can read "Holiday" right on the bar) so the manager doesn't mistake leave for bookable work or for an allocation they could drag. The block (like the over-marker) renders at **every** zoom level — it isn't a fine-zoom-only cue like the unavailable-day greying — so absences are always visible; the text **label** appears when the block is wide enough to fit it.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Set zoom to **4w** and **Jump to date** → `2026-06-01`. **Tyler Nix** has time off **10–12 June** with the reason **Holiday**.
1. Look at Tyler's row on **10–12 June**: a hatched **time-off block** spans those days.
2. Read its label: **"Holiday"** (visible because the block is wide enough at this range).
3. Confirm the block is visually distinct from an allocation bar — hatched, not a solid coloured bar — so it can't be mistaken for bookable work.

## Acceptance criteria
- ✅ Tyler's **10–12 June** shows a **time-off block** (`data-testid="timeoff-block"`).
- ✅ The block is labelled **"Holiday"** (the label shows when the block is wide enough to fit it).
- ✅ The time-off block is visible at the current **4w** zoom (it does not depend on fine zoom).
