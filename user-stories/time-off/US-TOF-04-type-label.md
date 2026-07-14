# US-TOF-04 — Time-off list reads terse; the type label lives on the timeline

**Area:** Time off · **Persona:** Studio manager · **Linked E2E:** `e2e/timeoff.spec.ts` → "keeps the list row terse (start date + day count); the type label stays on the timeline"

## Goal
Scan the Time off list as a plain "who's away, from when, and for how long" — each row shows the resource, a terse start date and a day count, and nothing else. The readable type label (e.g. "Holiday") still appears where it earns its place: on the matching timeline block.

## Why
The list answers one question — who is out and how long — so it stays deliberately terse: the end date, the type and any note would only slow the scan. The schedule is where the *kind* of absence and its exact span matter (it colours/labels and sizes the block), so the human label (`holiday → Holiday`, never the raw `holiday`) belongs there, not duplicated in the list.

## How (end-to-end)
**Precondition:** Seeded app open; click **Time off** in the sidebar (`/timeoff`). The seed has **Tyler Nix** off **10–12 June** with type *Holiday*.
1. Read the **Tyler Nix** row — it reads **Wed 10th Jun · 3 days**. There is no end date, type or note in the row.
2. Go to **Schedule** (`/`), zoom **1w** (so day columns are wide enough to render the block's label text), **Jump to date** → `2026-06-01`.
3. Read the label inside Tyler's `timeoff-block`.

## Acceptance criteria
- ✅ The Tyler Nix `timeoff-row` shows the resource name, the start date **Wed 10th Jun**, and **3 days** — and does **not** show the end date, the type ("Holiday"/`holiday`) or any note.
- ✅ The duration is carried by the day count alone (a one-day entry reads "… · 1 day", singular); the end date is never spelled out in the row.
- ✅ The timeline `timeoff-block` for that entry still carries the human type label **Holiday** (CSS-uppercased on the bar to `HOLIDAY` — same value, styled; not a defect), never the raw value `holiday`.
- ✅ Each type maps to its label consistently on the timeline: `holiday → Holiday`, `sick → Sick`, `unpaid → Unpaid`, `other → Other`.
