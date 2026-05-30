# US-SCH-14 — Overall and per-discipline load summary

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "shows overall and per-discipline average load summaries"

## Goal
The grid shows an overall load percentage in the top-left ("Load · next 2w") and a per-discipline average load in each group header — so the manager can read studio-wide and team-level load without scanning every row.

## Why
Individual load (US-SCH-13) answers "is *this* person busy?"; the summaries answer "is the *studio* busy, and which *team* is the bottleneck?" That's the view a manager needs for hiring and pipeline decisions. Surfacing the rollups right where the eye already lands — top-left for the whole studio, in each discipline header for the team — keeps planning a glance, not a spreadsheet.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`).
1. In the **top-left** of the grid, read the overall load figure under **"Load · next 2w"** — a **%** across all visible resources.
2. In each **discipline group header** (Design, Development, Copywriting), read its **"N% avg load"** — the average load of the resources in that group.
3. Collapse a discipline group (click its header — see US-SCH-16). Its header now shows **"N hidden"** (a count of the hidden rows) in place of the avg-load figure.
4. Expand it again and confirm the **"N% avg load"** returns.

## Acceptance criteria
- ✅ The top-left shows an **overall-utilization** figure (`data-testid="overall-utilization"`) as a % under **"Load · next 2w"**.
- ✅ Each discipline group header shows **"N% avg load"** while expanded.
- ✅ When a group is collapsed, its header shows **"N hidden"** (the hidden-row count) instead.
- ✅ Re-expanding the group restores its **"N% avg load"** figure.
