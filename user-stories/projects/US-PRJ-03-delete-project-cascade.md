# US-PRJ-03 — Delete a project (cascade; placeholder unbound, not deleted)

**Area:** Projects · **Persona:** Studio manager · **Linked E2E:** `e2e/projects.spec.ts` → "deletes a project and cascades its activities, restorable with undo"

## Goal
Remove a project and have its phases, activities and allocations go with it, while any placeholder bound to it is **unbound but kept**.

## Why
When a project is cancelled, the manager wants it and all its scheduled work gone in one step — but a placeholder is a hiring slot, not project data, so it must survive (just unbound). The action is destructive, so it's undoable.

## How (end-to-end)
**Precondition:** Seeded app open; click **Projects** in the sidebar (`/projects`). **Project Lightning** has phases (*Discovery*, *Build*), activities (*Wireframes*, *Visual Design*, *CMS Review*) and allocations; the **Senior Designer** placeholder (`r-ph-designer`) is bound to it.
1. On the **Project Lightning** row, click the **Delete** (trash) icon. The "Delete project?" confirmation dialog opens.
2. Read the dialog: it warns the delete cascades and is undoable — "You can undo this with ⌘Z."
3. Click **Delete** to confirm. The dialog closes.
4. Visit **Activities**, **Resources**, and the **Schedule** (`/`, **Jump to date** → `2026-06-01`) to inspect the result.
5. Press **⌘Z** (Undo) to reverse the deletion.

## Acceptance criteria
- ✅ The confirmation dialog is titled **Delete project?** and warns the delete cascades and is undoable ("You can undo this with ⌘Z.").
- ✅ After confirming, **Project Lightning** is gone from Projects; its phases (*Discovery*, *Build*) are gone; its activities (*Wireframes*, *Visual Design*, *CMS Review*) are gone from Activities; its allocation bars are gone from the schedule.
- ✅ The **Senior Designer** placeholder still exists as a resource — it is now **unbound**, **not deleted**.
- ✅ *Acme Inc.* still exists as a client (deleting a project does not delete its client); *Brand Themes* is untouched.
- ✅ Pressing **⌘Z** restores the project, its phases, activities and allocations, and re-binds the **Senior Designer** placeholder to it.
