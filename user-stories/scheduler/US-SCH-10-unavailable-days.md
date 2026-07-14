# US-SCH-10 — Unavailable days are greyed (weekends, non-working days, time off)

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "shows seeded resources, grouping and capacity cues"

## Goal
Days when a resource isn't available — weekends, their non-working weekdays, and their time-off days — are greyed on the timeline so they read as "don't book here."

## Why
Availability isn't uniform: a freelancer might work Mon–Wed, everyone has weekends, and people take holidays. Tinting those columns as unavailable means the manager plans *around* real capacity at a glance, instead of accidentally booking work onto a day that has zero available hours. (A day with no available hours is also why anything booked onto it counts as over-allocated — see US-SCH-09.) The greying (and the weekend tint) only paints at **fine zoom** — dayWidth ≥ 18, i.e. the **1w** or **2w** levels; at coarser zoom the day columns are too narrow to tint legibly, so this story must be checked at **1w/2w**. (Over-markers and time-off blocks, by contrast, render at any zoom.)

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Set zoom to **1w** (or **2w**) and **Jump to date** → `2026-06-01`. **Alex Rivera** is a freelancer working **Mon–Wed only**; **Tyler Nix** has time off **10–12 June**.
1. Look across any row: **weekend** columns (Sat/Sun) carry the **unavailable-day** grey tint.
2. Look at **Alex Rivera**'s row: their **Thursday and Friday** columns are greyed (non-working weekdays for a Mon–Wed freelancer).
3. Look at **Tyler Nix**'s row on **10–12 June**: those days are greyed as unavailable (his booked time off).
4. Zoom out to **4w** and note the greying no longer paints (expected — it's a fine-zoom cue).

## Acceptance criteria
- ✅ At **1w/2w**, weekend columns show the **unavailable-day** tint (`data-testid="unavailable-day"`).
- ✅ At **1w/2w**, Alex Rivera's **Thu/Fri** columns are greyed (non-working days for a Mon–Wed freelancer).
- ✅ At **1w/2w**, Tyler's **10–12 June** time-off days are greyed.
- ✅ At **4w** (and coarser) the greying does **not** render — it is a fine-zoom-only cue.
