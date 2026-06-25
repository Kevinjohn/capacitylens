# US-RES-03 — Edit a resource's fields

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "edits a resource and the change persists"

## Goal
Change an existing resource's details (role, working hours, discipline) and have those
changes reflected everywhere the resource appears.

## Why
People change roles, move disciplines or switch their working pattern. The manager edits
the one resource record and the list, the schedule grouping and the capacity all update —
there's no second place to keep in sync.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. On the **Nike Spiros** row, click the **Edit** (pencil) icon. The "Edit resource" dialog opens, pre-filled
   with the current values (Role *Web Developer*, Discipline *Development*, 8h, Mon–Fri).
2. Change **Role** = `Lead Developer`.
3. Change **Discipline** = *Design*.
4. Change **Working hours / day** from `8` to `6`.
5. Click **Save**. The dialog closes.

## Acceptance criteria
- ✅ The dialog reused in edit mode is titled **"Edit resource"** and every field is
  pre-filled with the resource's existing values when it opens.
- ✅ After Save, the Resources list row for **Nike Spiros** shows the new role
  (*Lead Developer*) and *6h/day*.
- ✅ On **Schedule**, the **Nike Spiros** row now appears under the **Design** group
  (moved out of *Development*).
- ✅ The changes persist across a page reload (data is held in `localStorage`).
