# US-TSK-01 — Add a task (general or under a project)

**Area:** Tasks · **Persona:** Studio manager · **Linked E2E:** `e2e/tasks.spec.ts` → "adds a general (no-project) task and a project-bound task"

## Goal
Add a task — either under a project or as a standalone *general* task — so it can be picked when allocating.

## Why
A task is a unit of work people get allocated to. Most belong to a project, so the allocation traces back to a client and project; but some internal or cross-cutting work isn't tied to one, so a task may be left **general** (no project). The manager adds a task once, then assigns people to it on the schedule.

## How (end-to-end)
**Precondition:** Seeded app open; click **Tasks** in the sidebar (`/tasks`). Projects *Project Lightning* and *Brand Themes* exist.
1. Click **Add task**. The "Add task" dialog opens.
2. Fill **Name** = `Internal sync` and leave **Project** as **"— No project (general task) —"**.
3. Click **Save**. The dialog closes.
4. Click **Add task** again; fill **Name** = `Accessibility Audit` and choose **Project** = *Project Lightning*. **Save**.
5. Open the **Schedule** (`/`), start an allocation against a resource, choose *Project Lightning*, and open the **Task** picker.

## Acceptance criteria
- ✅ The general task **Internal sync** saves and appears in the **General tasks** section of the list, with **no** client/project label on its row.
- ✅ The project task **Accessibility Audit** saves and appears under *Project Lightning*, its row labelled with the client · project.
- ✅ Saving with an empty **Name** is rejected (required-field error; the dialog stays open).
- ✅ When allocating with *Project Lightning* chosen, **Accessibility Audit** is selectable in the **Task** picker.
