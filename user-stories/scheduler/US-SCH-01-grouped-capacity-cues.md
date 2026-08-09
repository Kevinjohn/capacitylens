# US-SCH-01 — Resources grouped by discipline, with capacity cues

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "shows seeded resources, grouping and capacity cues"

## Goal

Open the schedule and see every resource grouped under its discipline, with at-a-glance cues for over-allocation, unavailable days and each person's utilisation.

## Why

The schedule is the studio manager's daily home page. Before touching anything they need to read the room: who sits in which discipline, who is overbooked, who is off, and each person's utilisation. Surfacing those cues on the grid itself — rather than buried in reports — is what makes the timeline a planning tool and not just a list of bars.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`).

1. Note the discipline group headers down the grid: **Design**, **Development**, **Copywriting** (the seed disciplines, in their sort order).
2. Confirm each resource row sits under the right group — e.g. **Tyler Nix** under **Design**, **Nike Spiros** and **Alex Rivera** under **Development**, **Pam Gonzalez** under **Copywriting**.
3. Click **Today** so the seed bars are in view. Tyler is over-allocated on **3–4 June** (8h + 4h > 8h): his bars there carry an over-allocation marker (a full-height tint with a top band).
4. Set **Weeks visible** to **1 week** (or **2 weeks**) so the fine-zoom greying renders, staying on the current week. Weekend columns and non-working days show the **unavailable-day** grey tint.
5. Read the left column: each row shows a **utilisation** percentage under **"Utilisation · Nw"**
   (N = the active week-range toggle), computed over the currently visible window. Separately, red
   emphasis marks over-allocation within the fixed forward 14-day window described by US-SCH-13.

## Acceptance criteria

- ✅ The grid shows **discipline group** headers (Design, Development, Copywriting) with resource rows nested under them.
- ✅ At `2026-06-01`, Tyler's 3–4 June shows at least one **over-marker** (`data-testid="over-marker"`).
- ✅ With **Weeks visible** set to **1 week** or **2 weeks**, at least one **unavailable-day** tint (`data-testid="unavailable-day"`) is visible (weekend / non-working day).
- ✅ Each resource row shows a **utilisation** figure (`data-testid="utilization"`).
