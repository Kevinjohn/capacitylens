# US-TOF-04 — Time-off type shows a human label

**Area:** Time off · **Persona:** Studio manager · **Linked E2E:** `e2e/timeoff.spec.ts` → "shows a human-readable type label in the list (not the raw enum)"

## Goal
See a readable type label (e.g. "Holiday") in the Time off list and on the matching timeline block, never the raw stored value (`holiday`).

## Why
The underlying data stores a terse code (`holiday`, `sick`, `unpaid`, `other`), but the manager scanning the list or the schedule shouldn't have to decode it. A consistent, capitalised label in both places keeps the list and the timeline reading the same.

## How (end-to-end)
**Precondition:** Seeded app open; click **Time off** in the sidebar (`/timeoff`). The seed has **Tyler Nix** off **10–12 June** with type *Holiday*.
1. Read the **Tyler Nix** row's type segment — it reads **Holiday**, not the raw `holiday`.
2. (Optional, to compare another label) Click **Add time off**, choose any **Resource**, set June dates, set **Type** = *Sick*, **Save**, and confirm that row reads **Sick**.
3. Go to **Schedule** (`/`), **Jump to date** → `2026-06-01`, zoom **1w** so day columns are wide enough to render the block's label text.
4. Read the label inside Tyler's `timeoff-block`.

## Acceptance criteria
- ✅ The Tyler Nix `timeoff-row` displays the type as **Holiday** (the human label), not the raw value `holiday`.
- ✅ The timeline `timeoff-block` for that entry carries the same type label as the list row (the block text is CSS-uppercased, so a tester sees `HOLIDAY` on the bar — same label value, just styled uppercase; this is not a defect).
- ✅ Each type maps to its label consistently in both places: `holiday → Holiday`, `sick → Sick`, `unpaid → Unpaid`, `other → Other`.
