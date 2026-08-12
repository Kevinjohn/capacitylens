# US-TOF-01 — Book time off for a resource

**Area:** Time off · **Persona:** Studio manager · **Linked E2E:** `e2e/timeoff.spec.ts` → "books time off and shows it as a labelled block on the schedule"

## Goal

Book a stretch of time off for one resource (resource, start, end, type and an optional note) so those days read as unavailable and nobody is scheduled into them.

## Why

People take holidays, get sick and book unpaid days. The manager records that once on the Time off page; from then on the schedule treats those days as zero-capacity for that resource, so planned work never collides with someone who isn't there.

## How (end-to-end)

**Precondition:** Seeded app open; click **Time off** in the sidebar (`/timeoff`).

1. Click **Add time off**. The "Add time off" dialog opens.
2. Choose **Resource** = _Clark Kent_ (`r-nike`).
3. Set **Start** = `2026-06-17` and **End** = `2026-06-19` (both in the seed's June window).
4. Set **Type** = _Holiday_.
5. Optionally type a short, single-line **Note** (e.g. `Long weekend`).
6. Click **Save**. The dialog closes and a new entry appears in the list.
7. Go to **Schedule** (`/`), click **Today** so the seed bars are in view, and set **Weeks visible** to **1 week** so individual day columns are wide enough to render the per-day tint and the block label.

## Acceptance criteria

- ✅ After Save, the dialog closes and a `timeoff-row` for **Clark Kent** appears in the Time off list, reading **Clark Kent · Wed 17th Jun · 3 days**. (The list is deliberately terse — the end date, the type and any note are stored and shown on the timeline block, not in this row; see US-TOF-04.)
- ✅ On the Schedule (click **Today**, **Weeks visible** = **1 week**), Clark's lane shows a labelled `timeoff-block` over 17–19 June carrying the type label (the block label renders once a column is wide enough — use 1 week).
- ✅ Those days read as unavailable: each covered day in Clark's lane is greyed (`data-testid="unavailable-day"`), reflecting 0 available hours.
- ✅ Saving with **no Resource** selected keeps the dialog open and is rejected with the inline error "Choose a resource." (`aria-invalid` on the Resource field).
- ✅ Clearing **Start** or **End** so a date is empty keeps the dialog open and is rejected with "Start and end dates are required." (`aria-invalid` on the date fields).
- ✅ Saving with **End** before **Start** (e.g. End `2026-06-15`, Start `2026-06-17`) keeps the dialog open and is rejected with "End date cannot be before the start date."
- ✅ **Note** is a single-line text input. An empty note remains valid; a populated note persists
  across reopening the entry; Editor/Viewer do not receive or submit the protected field.
