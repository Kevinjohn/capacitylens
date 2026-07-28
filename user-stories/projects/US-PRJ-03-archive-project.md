# US-PRJ-03 — Archive a project (hide from the schedule) and undo

**Area:** Projects · **Persona:** Studio manager · **Linked E2E:** `e2e/projects.spec.ts` → "archiving a project hides it from the list, restorable with undo"

## Goal
Remove a project from the active views **reversibly** — archive it (with a clear warning and one-step
undo) so the project and its phases/activities/allocations are retained and it can be restored, or
later permanently deleted from Settings → Archived & deleted.

## Why
When a project pauses or is cancelled, the manager wants it off the schedule in one step — but without
destroying its scheduled work. Archiving hides the project from the active views while keeping its
data; soft-delete and permanent removal (which DO cascade to phases/activities/allocations and unbind
placeholders) are separate, later steps reached from Settings → Archived & deleted. Archiving is
reversible, so the action is undoable.

## How (end-to-end)
**Precondition:** Seeded app open; click **Projects** in the sidebar (`/projects`). **Project
Lightning** has phases (*Discovery*, *Build*), activities (*Wireframes*, *Visual Design*, *CMS
Review*) and allocations.
1. On the **Project Lightning** row, click the **Archive Project Lightning** (trash) icon. The
   "Archive project?" confirmation dialog opens.
2. Read the dialog: it explains the project will be hidden from the schedule and can be restored or
   permanently deleted from **Settings → Archived & deleted**.
3. Click **Archive** to confirm. The dialog closes and **Project Lightning** leaves the Projects list.
4. Press **⌘Z** (Undo, LOCAL mode) to reverse the archive — Project Lightning returns to the list.

## Acceptance criteria
- ✅ The confirmation dialog is titled **Archive project?** and explains the project is hidden from the
  schedule and is restorable from Settings → Archived & deleted.
- ✅ After confirming, **Project Lightning** is gone from the Projects management list (archived, not
  destroyed).
- ✅ The project, its phases, activities and allocations are **retained** in the data — archiving
  filters each row by its OWN status (it does not cascade-delete the children).
- ✅ Archived projects surface in **Settings → Archived & deleted**, where they can be restored or
  (after soft-delete + the 30-day grace) permanently deleted.
- ✅ (LOCAL mode) Pressing **⌘Z** restores the project to the active list; in server mode, **Restore**
  from Settings → Archived & deleted brings it back.
