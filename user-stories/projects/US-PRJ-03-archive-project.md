# US-PRJ-03 — Archive a project (hide from the schedule) and restore

**Area:** Projects · **Persona:** Studio manager · **Linked E2E:** `e2e/projects.spec.ts` → "archiving a project hides it from the list, and undo leaves it archived"

## Goal

Remove a project from the active views **reversibly** — archive it (with a clear warning) so the project and its phases/activities/allocations are retained and it can be restored.

## Why

When a project pauses or is cancelled, the manager wants it off the schedule in one step — but without
destroying its scheduled work. Archiving hides the project from the active views while keeping its
data. There is no deletion step: an archived project stays until it is restored. Archiving is
reversible through **Restore**.

## How (end-to-end)

**Precondition:** Seeded app open; click **Projects** in the sidebar (`/projects`). **Project
Watchtower** has phases (_Discovery_, _Build_), activities (_Wireframes_, _Visual Design_, _CMS
Review_) and allocations.

1. On the **Project Watchtower** row, click the **Archive Project Watchtower** (trash) icon. The
   "Archive project?" confirmation dialog opens.
2. Read the dialog: it explains the project will be hidden from the schedule and can be restored
   from **Archived projects** below the list.
3. Click **Archive** to confirm. The dialog closes and **Project Watchtower** leaves the Projects list.
4. Press **⌘Z**. Project Watchtower stays archived: Undo and Redo currently cover booking changes only.

## Acceptance criteria

- ✅ The confirmation dialog is titled **Archive project?** and explains the project is hidden from the
  schedule and is restorable from Archived projects.
- ✅ After confirming, **Project Watchtower** is gone from the Projects management list (archived, not
  destroyed).
- ✅ The project, its phases, activities and allocations are **retained** in the data — the active
  view hides descendants through their archived ancestry without changing their own status.
- ✅ Restoring the project brings attributed All-projects allocations back with their attribution
  intact, including after an ordinary allocation drag or edit.
- ✅ Archived projects surface under **Archived projects**, where they can be restored. No
  permanent deletion exists.
- ✅ Pressing **⌘Z** leaves the project archived; **Restore** from Archived projects brings it back.
