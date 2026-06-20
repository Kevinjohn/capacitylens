# US-TSK-01 — Add a task (internal, repeatable, or under a project)

**Area:** Tasks · **Persona:** Studio manager · **Linked E2E:** `e2e/tasks.spec.ts` → "adds an internal, a repeatable, and a project task into their three sections"

## Goal
Add a task of any of the three kinds — **Project**, **Internal**, or **Repeatable** — so it can be picked when allocating.

## Why
A task is a unit of work people get allocated to. Most belong to a project, so the allocation traces back to a client and project. But internal work (Admin, internal review) isn't tied to a client, and some work recurs across projects (Design, Workshop) — a *repeatable* task used on many projects. The kind drives where the task lives on the Tasks page and how the schedule's task lens groups it.

## How (end-to-end)
**Precondition:** Seeded app open; click **Tasks** in the sidebar (`/tasks`). Projects *Project Lightning* and *Brand Themes* exist. The page shows three sections: **Internal tasks**, **Repeatable tasks**, **Project tasks**.
1. Click **Add task**. The "Add task" dialog opens with a **Task kind** radiogroup (default **Project**).
2. Fill **Name** = `Internal sync`, click the **Internal** kind. The **Project** field disappears. Click **Save**.
3. Click **Add task**; **Name** = `Discovery workshop`, click **Repeatable**, **Save**.
4. Click **Add task**; **Name** = `Spec review`, leave kind **Project**, choose **Project** = *Project Lightning*, **Save**.
5. Open the **Schedule** (`/`), start an allocation against a resource, choose *Project Lightning*, and open the **Task** picker.

## Acceptance criteria
- ✅ **Internal sync** saves into the **Internal tasks** section (testid `internal-tasks`), with **no** project label.
- ✅ **Discovery workshop** saves into the **Repeatable tasks** section (testid `repeatable-tasks`).
- ✅ **Spec review** saves into the **Project tasks** section (testid `project-tasks`), its row labelled with the client · project.
- ✅ Saving an empty **Name** is rejected (required-field error; the dialog stays open).
- ✅ Saving a **Project**-kind task with **no project chosen** is rejected ("A project task must be assigned to a project."); the dialog stays open.
- ✅ When allocating with *Project Lightning* chosen, project tasks **plus** internal/repeatable tasks are selectable in the **Task** picker.
