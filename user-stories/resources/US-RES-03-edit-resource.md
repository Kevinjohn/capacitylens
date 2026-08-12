# US-RES-03 — Edit a resource's fields

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "edits a resource and the change persists"

## Goal

Change an existing resource's details (role, discipline and working pattern) and have those
changes reflected everywhere the resource appears.

## Why

People change roles, move disciplines or switch their working pattern. The manager edits
the one resource record and the list, the schedule grouping and the capacity all update —
there's no second place to keep in sync.

## How (end-to-end)

**Precondition:** Seeded app open; click **Resources** in the sidebar.

1. On the **Clark Kent** row, click the **Edit** (pencil) icon. The "Edit resource" dialog opens, pre-filled
   with the current values (Role _Web Developer_, Discipline _Development_, Mon–Fri full days).
2. Change **Role** = `Lead Developer`.
3. Change **Discipline** = _Design_.
4. Change Wednesday to **Half day**.
5. Click **Save**. The dialog closes.

## Acceptance criteria

- ✅ The dialog reused in edit mode is titled **"Edit resource"** and every field is
  pre-filled with the resource's existing values when it opens.
- ✅ After Save, the Resources list row for **Clark Kent** shows the new role
  (_Lead Developer_) without redundant hours-per-day text.
- ✅ The edited resource is saved with an 8-hour full day; this also normalises any legacy custom
  `workingHoursPerDay` value when that resource is next edited.
- ✅ On **Schedule**, the **Clark Kent** row now appears under the **Design** group
  (moved out of _Development_).
- ✅ In the server-backed app, the changes persist across a page reload.
- ✅ In the public demo, the change lasts for the current page only and reload restores the seed.
