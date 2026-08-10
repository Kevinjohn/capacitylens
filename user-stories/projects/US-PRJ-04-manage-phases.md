# US-PRJ-04 — Manage phases inside a project

> **⏸ Not runnable today — the Phase UI is currently hidden.** Phases remain in the data model,
> but the Project dialog **no longer exposes add/remove-phase controls** (hidden along with the
> activity Phase picker — see `ProjectForm.tsx` / `ActivityForm.tsx`). Kept for when phase management is
> re-surfaced; the steps below describe that intended behaviour and are **not executable in the
> current build**.

**Area:** Projects · **Persona:** Studio manager · **Coverage:** none currently (Phase UI hidden)

## Goal

Add and remove a project's phases from within the Project edit dialog (phases are managed per-project, not on a top-level screen), and have the changes flow through to where phases are picked.

## Why

Phases (Discovery, Build…) are how a single project's work is staged. They live with their project, so the manager edits them in the project dialog. A new phase should immediately be choosable when creating that project's activities and allocations; removing a phase should re-stage — never delete — the activities that were in it.

## How (end-to-end)

**Precondition:** Seeded app open; click **Projects** in the sidebar (`/projects`). **Project Watchtower** has phases _Discovery_ and _Build_. The activity _Wireframes_ belongs to Project Watchtower.

1. On the **Project Watchtower** row, click the **Edit** (pencil) icon. The dialog opens and shows its phases _Discovery_ and _Build_.
2. Add a new phase named `Launch`. **Save** the dialog.
3. Go to **Activities**, **Edit** _Wireframes_, ensure its **Project** is _Project Watchtower_, open the **Phase** picker, set **Phase** = _Discovery_, and **Save**.
4. Re-open **Project Watchtower** in **Projects**, and remove the **Discovery** phase. **Save**.
5. Go back to **Activities** and inspect _Wireframes_ (which you assigned to _Discovery_).

## Acceptance criteria

- ✅ After adding **Launch** and saving, the project's phase set includes _Discovery_, _Build_ and **Launch**.
- ✅ When editing an activity whose **Project** is _Project Watchtower_, **Launch** is offered in the **Phase** picker (alongside _Discovery_ and _Build_ and the "— No phase —" option).
- ✅ Removing the **Discovery** phase does **not** delete the activities that were in it — _Wireframes_ (which you put in _Discovery_ at step 3) remains in the Activities list, now **ungrouped** (no phase, i.e. "— No phase —").
- ✅ Phases of **Project Watchtower** are only offered for _Project Watchtower_'s activities/allocations — they are not offered when the selected project is _Metropolis Rebrand_.
