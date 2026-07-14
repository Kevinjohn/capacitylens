# US-SCH-01 — Resources grouped by discipline, with capacity cues

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "shows seeded resources, grouping and capacity cues"

## Goal
Open the schedule and see every resource grouped under its discipline, with at-a-glance cues for over-allocation, unavailable days and each person's load.

## Why
The schedule is the studio manager's daily home page. Before touching anything they need to read the room: who sits in which discipline, who is overbooked, who is off, and how loaded each person is. Surfacing those cues on the grid itself — rather than buried in reports — is what makes the timeline a planning tool and not just a list of bars.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`).
1. Note the discipline group headers down the grid: **Design**, **Development**, **Copywriting** (the seed disciplines, in their sort order).
2. Confirm each resource row sits under the right group — e.g. **Tyler Nix** under **Design**, **Nike Spiros** and **Alex Rivera** under **Development**, **Pam Gonzalez** under **Copywriting**.
3. **Jump to date** → `2026-06-01` so the seed bars are in view. Tyler is over-allocated on **3–4 June** (8h + 4h > 8h): his bars there carry an over-allocation marker (a full-height tint with a top band).
4. Set zoom to **1w** (or **2w**) so the fine-zoom greying renders, and keep **Jump to date** at `2026-06-01`. Weekend columns and non-working days show the **unavailable-day** grey tint.
5. Read the left column: each row shows a **utilisation** figure ("Utilisation · next 2w"), the per-person near-term load.

## Acceptance criteria
- ✅ The grid shows **discipline group** headers (Design, Development, Copywriting) with resource rows nested under them.
- ✅ At `2026-06-01`, Tyler's 3–4 June shows at least one **over-marker** (`data-testid="over-marker"`).
- ✅ At **1w/2w** zoom, at least one **unavailable-day** tint (`data-testid="unavailable-day"`) is visible (weekend / non-working day).
- ✅ Each resource row shows a **utilization** figure (`data-testid="utilization"`).
