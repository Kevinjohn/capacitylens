# US-TSK-01 — Add a task (must belong to a project)

**Area:** Tasks · **Persona:** Studio manager · **Linked E2E:** `e2e/tasks.spec.ts` → "rejects a task without a project and adds one with a project"

## Goal
Add a new task under a project so it can be picked when allocating — and confirm a task cannot be saved without a project.

## Why
A task is a unit of a project's work; it has no meaning detached from one. Enforcing the project link keeps the hierarchy clean and ensures every allocation can trace back to a client and project. The manager adds a task once, then assigns people to it on the schedule.

## How (end-to-end)
**Precondition:** Seeded app open; click **Tasks** in the sidebar (`/tasks`). Projects *Project Lightning* and *Brand Themes* exist.
1. Click **Add task**. The "Add task" dialog opens.
2. Fill **Name** = `Accessibility Audit` but leave **Project** unset.
3. Click **Save** — observe it is rejected.
4. Now choose **Project** = *Project Lightning*.
5. Click **Save**. The dialog closes.
6. Open the **Schedule** (`/`), start an allocation against a resource, and open the **Task** picker.

## Acceptance criteria
- ✅ Saving with **Project** unset keeps the dialog open and shows the error **"A task must belong to a project."** (an `alert`).
- ✅ After choosing *Project Lightning* and Save, the dialog closes and **Accessibility Audit** appears in the Tasks list under *Project Lightning*.
- ✅ When allocating, **Accessibility Audit** is selectable in the **Task** picker once *Project Lightning* is the chosen project.
- ✅ Saving with an empty **Name** is also rejected (required-field error, dialog stays open).
