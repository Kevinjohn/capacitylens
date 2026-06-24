# US-SCH-09 — Over-allocated days are flagged with an over-marker

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "shows seeded resources, grouping and capacity cues"; `e2e/weekend-overmarker.spec.ts` → "a spanned weekend is not over; include-weekends and time-off are"

## Goal
Any day where a resource's allocated hours exceed their available hours is flagged on the timeline with an over-marker — a full-height tint plus a band across the top of the column.

## Why
Over-allocation is the single most important signal in a capacity tool: it's the difference between a plan that's deliverable and one that quietly burns someone out. Painting the offending day red across its full height — and adding a top band so it reads even where bars don't fill the column — turns "someone, somewhere is overbooked" into "*this* person on *this* day," which is what lets the manager fix it. Unlike the weekend/unavailable greying (which only paints at fine zoom — see US-SCH-10), the **over-marker** is a hard scheduling warning and renders at **every** zoom level, so over-allocation is never hidden just because you zoomed out.

**Weekends don't count unless you opt in.** A normal allocation does no work on a resource's non-working weekdays, so a bar that merely **spans** a weekend leaves Sat/Sun greyed (unavailable) but **not** red — those days aren't "over". Two zero-capacity days still DO flag red, because they're real conflicts: (a) work scheduled on a **time-off / holiday** day, and (b) a weekend an allocation explicitly includes via **"Include weekends as working days"** (the resource still has 0 weekend capacity, so that weekend work honestly reads as over).

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Set zoom to **4w** and **Jump to date** → `2026-06-01`. **Tyler Nix** is over-allocated on **3–4 June** (8h on one allocation + 4h on another > his 8h/day).
1. Look at Tyler's row on **3–4 June**: those columns carry the over-marker (full-height tint with a top band).
2. Confirm a non-over-allocated day (e.g. a day with a single 8h booking) carries **no** over-marker.
3. Add hours to a day that was previously fine: open an allocation on a day at capacity and raise its **Hours / day** (or draw a second bar on the same day) so the total exceeds available. That day is now flagged with an over-marker too.

## Acceptance criteria
- ✅ Tyler's **3–4 June** shows at least one **over-marker** (`data-testid="over-marker"`).
- ✅ A day where allocated ≤ available shows **no** over-marker.
- ✅ Pushing a day's total allocated hours above available (more hours, or an extra bar) flags that day with an over-marker.
- ✅ The over-marker is visible at the current **4w** zoom (it does not depend on fine zoom).
- ✅ A weekend that an allocation merely **spans** (default, weekend-aware) shows **no** over-marker — only the grey unavailable tint.
- ✅ An allocation with **"Include weekends as working days"** on flags its weekend days with an over-marker (the resource has 0 weekend capacity).
- ✅ Work scheduled on a **time-off / holiday** day still shows the over-marker (a real conflict, unlike a merely-spanned weekend).
