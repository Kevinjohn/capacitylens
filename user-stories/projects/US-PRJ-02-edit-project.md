# US-PRJ-02 — Edit a project

**Area:** Projects · **Persona:** Studio manager · **Linked E2E:** `e2e/projects.spec.ts` → "edits a project name"

## Goal
Change a project's name, owning client and colour, and see the changes reflected — including the colour of its allocation bars on the schedule.

## Why
Projects get renamed, move between clients (a brand handed to a different account), and get re-coloured for clarity on a busy timeline. The schedule reads project work by colour, so a colour change must follow through to the bars immediately.

## How (end-to-end)
**Precondition:** Seeded app open; click **Projects** in the sidebar (`/projects`). **Project Lightning** belongs to *Acme Inc.* and has allocations in June 2026.
1. On the **Project Lightning** row, click **Edit**. The dialog opens pre-filled.
2. Change **Name** = `Project Thunder`.
3. Change **Client** = *Globex*.
4. Change the **Colour** by opening it and picking a different swatch.
5. Click **Save**. The dialog closes.
6. Open the **Schedule** (`/`) and **Jump to date** → `2026-06-01` to see this project's bars.

## Acceptance criteria
- ✅ The Projects list row now reads **Project Thunder** and its "Client / Project" label shows *Globex*.
- ✅ On the **Schedule**, the allocation bars that belonged to this project now render in the **new project colour**.
- ✅ The project's activities and allocations are preserved through the edit — only name, client and colour changed.
- ✅ Clearing **Name** to empty and clicking **Save** is rejected (required-field error, dialog stays open).
- ✅ Removing the **Client** entirely and clicking **Save** is rejected with **"A project must belong to a client."**
