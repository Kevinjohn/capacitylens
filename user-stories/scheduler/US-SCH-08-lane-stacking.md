# US-SCH-08 — Overlapping allocations stack into separate lanes

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "stacks overlapping allocations onto a taller row (US-SCH-08)"

## Goal
When two allocations on the same resource overlap in time, they stack onto separate vertical lanes within that resource's row (making the row taller); allocations that don't overlap share one lane.

## Why
A person can legitimately be on two things at once (that's exactly how over-allocation happens). If overlapping bars drew on top of each other you couldn't see the second commitment at all. Stacking them — and growing the row to fit — makes the double-booking visible, which is the whole point of a capacity view. Non-overlapping work shares a lane so rows stay compact when there's no conflict.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Set zoom to **4w** and **Jump to date** → `2026-06-01`. **Tyler Nix** has two seed allocations that overlap on **3–4 June** (8h + 4h), which is what over-allocates him.
1. Look at Tyler's row in early June.
2. Note the two bars that overlap on 3–4 June: they are drawn on **different vertical lanes** within Tyler's row, one above the other — not stacked on top of each other.
3. Note that Tyler's row is **taller** than a row that has no overlapping work (e.g. a single-lane row like Pam's).
4. Compare with a resource whose allocations never overlap: those bars share a single lane and the row is the shorter, single-lane height.

## Acceptance criteria
- ✅ Tyler's two overlapping seed bars (the 3–4 June pair) render on **different vertical lanes** within his row.
- ✅ Tyler's row is **taller** than a single-lane row (it has grown to fit two stacked lanes).
- ✅ A resource with no overlapping allocations keeps a single lane and the shorter row height.
