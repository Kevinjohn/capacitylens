# US-TSK-03 — Edit a task

**Area:** Tasks · **Persona:** Studio manager · **Linked E2E:** `e2e/tasks.spec.ts` → "edits a task and reflects the change in the task list and allocation pickers"

## Goal
Change a task's name, project and phase, and see the change reflected in the Tasks list and in the allocation pickers.

## Why
Work gets re-scoped: a task is renamed, moved to another project, or re-staged into a different phase. Those edits must propagate so the manager always allocates against accurate, current task options.

## How (end-to-end)
**Precondition:** Seeded app open; click **Tasks** in the sidebar (`/tasks`). The task *CMS Review* belongs to *Project Lightning*.
1. On the **CMS Review** row, click **Edit**. The dialog opens pre-filled.
2. Change **Name** = `CMS Build`.
3. Change **Project** = *Brand Themes* (note: changing project resets the **Phase** — see US-TSK-02).
4. Leave **Phase** = "— No phase —" (Brand Themes has no phases).
5. Click **Save**. The dialog closes.
6. Open the **Schedule** (`/`), start an allocation, set the **Project** to *Brand Themes*, and open the **Task** picker.

## Acceptance criteria
- ✅ The Tasks list row now reads **CMS Build** under *Brand Themes* (no longer under *Project Lightning*).
- ✅ When allocating with **Project** = *Brand Themes*, **CMS Build** appears in the **Task** picker.
- ✅ When allocating with **Project** = *Project Lightning*, **CMS Build** no longer appears (it moved off that project).
- ✅ Clearing **Name** to empty and clicking **Save** is rejected (required-field error, dialog stays open).
- ✅ Removing the **Project** entirely and clicking **Save** is rejected with **"A task must belong to a project."**
