# US-RES-08 — Group a resource under a discipline

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/disciplines.spec.ts` → "deletes a discipline and ungroups its resources without deleting them" (exercises resource-under-discipline grouping and the engagement fallback)

## Goal

Assign a resource to a discipline so they group under that discipline's header on the
schedule, or leave them unassigned with "— None —" and grouped by engagement.

## Why

The schedule is organised by discipline (Design, Development, Copywriting) so a manager can
read capacity team-by-team. Putting each resource in the right discipline keeps the timeline
legible; an unassigned resource still has a home in a catch-all bucket.

## How (end-to-end)

**Precondition:** Seeded app open; click **Resources** in the sidebar.

1. On the **Diana Prince** row, click the **Edit** (pencil) icon. (Seeded discipline: _Copywriting_.)
2. Change **Discipline** = _Design_. Click **Save**.
3. Go to **Schedule**: Diana now appears under the **Design** discipline group header.
4. Edit **Diana Prince** again, set **Discipline** = _— None —_, and Save.
5. Return to **Schedule**.

## Acceptance criteria

- ✅ With a discipline chosen, the resource appears under that discipline's group header on
  **Schedule** (`data-testid="discipline-group"`).
- ✅ With **Discipline** = _— None —_, the resource appears after the assigned discipline bands in
  **Studio** or **Supplementary** according to engagement. If engagement grouping is off, it appears
  in **Unassigned** instead.
- ✅ The grouping reflects the saved discipline immediately on returning to the schedule.
