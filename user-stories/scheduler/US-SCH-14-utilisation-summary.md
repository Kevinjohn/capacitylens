# US-SCH-14 — Overall and per-discipline load summary

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "shows overall and per-discipline utilisation summaries (US-SCH-14)" and "the week-range toggle recomputes utilisation over the visible window (US-SCH-14)"

## Goal
The grid shows an overall load percentage in the top-left ("Utilisation · Nw", where N tracks the week-range toggle) and a per-discipline average load in each group header — so the manager can read studio-wide and team-level load without scanning every row. These figures are computed over the **currently visible window** (the 1/2/4/8-week range), so switching the range toggle recomputes them to reflect exactly the visible span.

## Why
Individual load (US-SCH-13) answers "is *this* person busy?"; the summaries answer "is the *studio* busy, and which *team* is the bottleneck?" That's the view a manager needs for hiring and pipeline decisions. Surfacing the rollups right where the eye already lands — top-left for the whole studio, in each discipline header for the team — keeps planning a glance, not a spreadsheet.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`).
1. In the **top-left** of the grid, read the overall load figure under **"Utilisation · next 2w"** — a **%** across all visible resources.
2. In each **discipline group header** (Design, Development, Copywriting), read its **"N% avg utilisation"** — the average load of the resources in that group.
3. Collapse a discipline group (click its header — see US-SCH-16). Its header now shows **"N hidden"** (a count of the hidden rows) in place of the avg-load figure.
4. Expand it again and confirm the **"N% avg utilisation"** returns.
5. Click the **week-range toggle** through **1w → 2w → 4w → 8w**. The top-left label updates to **"Utilisation · 1w/2w/4w/8w"** and the **overall %** changes at each step — it now reflects the work in *exactly* the visible span. With the seed (work concentrated in the opening week), a narrow span reads busier than a wide one that folds in the quieter later weeks.

## Acceptance criteria
- ✅ The top-left shows an **overall-utilization** figure (`data-testid="overall-utilization"`) as a % under **"Utilisation · Nw"** (N = the active week-range toggle).
- ✅ Each discipline group header shows **"N% avg utilisation"** while expanded.
- ✅ When a group is collapsed, its header shows **"N hidden"** (the hidden-row count) instead.
- ✅ Re-expanding the group restores its **"N% avg utilisation"** figure.
- ✅ Switching the **week-range toggle** (1/2/4/8 weeks) recomputes the overall % (and per-person/per-discipline figures) to reflect the visible span — a wider span dilutes the dense opening week to a lower number.
- ✅ The per-person **red** over-soon flag stays on the **fixed forward 14-day** window (it does not move with the toggle).
