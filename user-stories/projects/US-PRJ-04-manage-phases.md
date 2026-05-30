# US-PRJ-04 — Manage phases inside a project

**Area:** Projects · **Persona:** Studio manager · **Linked E2E:** `e2e/projects.spec.ts` → "adds and removes phases in the project dialog and ungroups tasks of a removed phase"

## Goal
Add and remove a project's phases from within the Project edit dialog (phases are managed per-project, not on a top-level screen), and have the changes flow through to where phases are picked.

## Why
Phases (Discovery, Build…) are how a single project's work is staged. They live with their project, so the manager edits them in the project dialog. A new phase should immediately be choosable when creating that project's tasks and allocations; removing a phase should re-stage — never delete — the tasks that were in it.

## How (end-to-end)
**Precondition:** Seeded app open; click **Projects** in the sidebar (`/projects`). **Project Lightning** has phases *Discovery* and *Build*. The task *Wireframes* belongs to Project Lightning.
1. On the **Project Lightning** row, click **Edit**. The dialog opens and shows its phases *Discovery* and *Build*.
2. Add a new phase named `Launch`. **Save** the dialog.
3. Go to **Tasks**, **Edit** *Wireframes*, ensure its **Project** is *Project Lightning*, open the **Phase** picker, set **Phase** = *Discovery*, and **Save**.
4. Re-open **Project Lightning** in **Projects**, and remove the **Discovery** phase. **Save**.
5. Go back to **Tasks** and inspect *Wireframes* (which you assigned to *Discovery*).

## Acceptance criteria
- ✅ After adding **Launch** and saving, the project's phase set includes *Discovery*, *Build* and **Launch**.
- ✅ When editing a task whose **Project** is *Project Lightning*, **Launch** is offered in the **Phase** picker (alongside *Discovery* and *Build* and the "— No phase —" option).
- ✅ Removing the **Discovery** phase does **not** delete the tasks that were in it — *Wireframes* (which you put in *Discovery* at step 3) remains in the Tasks list, now **ungrouped** (no phase, i.e. "— No phase —").
- ✅ Phases of **Project Lightning** are only offered for *Project Lightning*'s tasks/allocations — they are not offered when the selected project is *Brand Themes*.
