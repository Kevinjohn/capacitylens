# US-RES-08 — Group a resource under a discipline

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/disciplines.spec.ts` → "deletes a discipline and ungroups its resources without deleting them" (exercises resource-under-discipline grouping and the *No discipline* group)

## Goal
Assign a resource to a discipline so they group under that discipline's header on the
schedule, or leave them ungrouped with "— None —".

## Why
The schedule is organised by discipline (Design, Development, Copywriting) so a manager can
read capacity team-by-team. Putting each resource in the right discipline keeps the timeline
legible; an unassigned resource still has a home in a catch-all bucket.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. On the **Pam Gonzalez** row, click **Edit**. (Seeded discipline: *Copywriting*.)
2. Change **Discipline** = *Design*. Click **Save**.
3. Go to **Schedule**: Pam now appears under the **Design** discipline group header.
4. Edit **Pam Gonzalez** again, set **Discipline** = *— None —*, and Save.
5. Return to **Schedule**.

## Acceptance criteria
- ✅ With a discipline chosen, the resource appears under that discipline's group header on
  **Schedule** (`data-testid="discipline-group"`).
- ✅ With **Discipline** = *— None —*, the resource appears under a group titled
  **"No discipline"**.
- ✅ The grouping reflects the saved discipline immediately on returning to the schedule.
