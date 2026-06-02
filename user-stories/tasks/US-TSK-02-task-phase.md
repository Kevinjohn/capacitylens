# US-TSK-02 — Assign a task to a phase (optional; resets on project change)

> **⏸ Not runnable today — the Phase UI is currently hidden.** Phases remain in the data model
> (an existing task keeps its phase, and it still drops if the task moves to another project),
> but the task dialog **no longer shows a Phase picker** (`TaskForm.tsx`: "Phase UI is hidden
> for now"). Kept for when phase management is re-surfaced; the steps below describe that
> intended behaviour and are **not executable in the current build**.

**Area:** Tasks · **Persona:** Studio manager · **Coverage:** none currently (Phase UI hidden)

## Goal
Optionally place a task into one of its project's phases, with only that project's phases offered, and have the phase reset if the task's project is changed.

## Why
Phases stage a project's work, but not every task belongs to one — so the phase is optional. Crucially, a phase only makes sense within its own project; if the manager moves a task to a different project, the old phase must clear rather than silently carry over an invalid reference.

## How (end-to-end)
**Precondition:** Seeded app open; click **Tasks** in the sidebar (`/tasks`). The task *Wireframes* belongs to *Project Lightning* (phases *Discovery*, *Build*). *Brand Themes* has no phases.
1. On the **Wireframes** row, click **Edit**. The dialog opens with **Project** = *Project Lightning*.
2. Open the **Phase** picker and note the available options.
3. Select **Phase** = *Discovery*. (Leaving it as "— No phase —" would also be valid — the phase is optional.)
4. Now change **Project** to *Brand Themes* and re-open the **Phase** picker.

## Acceptance criteria
- ✅ With **Project** = *Project Lightning*, the **Phase** picker offers only that project's phases — *Discovery* and *Build* — plus the optional **"— No phase —"**.
- ✅ The phase is **optional**: a task can be saved with **"— No phase —"** selected.
- ✅ Selecting *Discovery* and saving records that task under the *Discovery* phase.
- ✅ Changing the **Project** to *Brand Themes* **resets the phase** (it returns to "— No phase —", since *Discovery* is not a Brand Themes phase).
- ✅ With **Project** = *Brand Themes* (no phases), the **Phase** picker offers only **"— No phase —"**.
