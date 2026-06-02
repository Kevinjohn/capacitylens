# US-TOF-01 — Book time off for a resource

**Area:** Time off · **Persona:** Studio manager · **Linked E2E:** `e2e/timeoff.spec.ts` → "books time off and shows it as a labelled block on the schedule"

## Goal
Book a stretch of time off for one resource (resource, start, end, type and an optional note) so those days read as unavailable and nobody is scheduled into them.

## Why
People take holidays, get sick and book unpaid days. The manager records that once on the Time off page; from then on the schedule treats those days as zero-capacity for that resource, so planned work never collides with someone who isn't there.

## How (end-to-end)
**Precondition:** Seeded app open; click **Time off** in the sidebar (`/timeoff`).
1. Click **Add time off**. The "Add time off" dialog opens.
2. Choose **Resource** = *Nike Spiros* (`r-nike`).
3. Set **Start** = `2026-06-17` and **End** = `2026-06-19` (both in the seed's June window).
4. Set **Type** = *Holiday*.
5. Optionally type a **Note** (e.g. `Long weekend`).
6. Click **Save**. The dialog closes and a new entry appears in the list.
7. Go to **Schedule** (`/`), use **Jump to date** → `2026-06-01`, and set the zoom to **1w** so individual day columns are wide enough to render the per-day tint and the block label.

## Acceptance criteria
- ✅ After Save, the dialog closes and a `timeoff-row` for **Nike Spiros** appears in the Time off list, reading `Nike Spiros · 2026-06-17 → 2026-06-19 · Holiday` (plus the note if entered).
- ✅ On the Schedule (Jump to date → 2026-06-01, zoom **1w**), Nike's lane shows a labelled `timeoff-block` over 17–19 June carrying the type label (the block label renders once a column is wide enough — use 1w).
- ✅ Those days read as unavailable: each covered day in Nike's lane is greyed (`data-testid="unavailable-day"`), reflecting 0 available hours.
- ✅ Saving with **no Resource** selected keeps the dialog open and is rejected with the inline error "Choose a resource." (`aria-invalid` on the Resource field).
- ✅ Clearing **Start** or **End** so a date is empty keeps the dialog open and is rejected with "Start and end dates are required." (`aria-invalid` on the date fields).
- ✅ Saving with **End** before **Start** (e.g. End `2026-06-15`, Start `2026-06-17`) keeps the dialog open and is rejected with "End date cannot be before the start date."
