# US-ALL-05 — Add a new task inline from the modal

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "adds a new task inline and uses it for the allocation"

## Goal
Add a brand-new task to the selected project from inside the allocation modal, and immediately use it for the allocation — without leaving to the Tasks page.

## Why
When booking work, the right task often doesn't exist yet. Forcing the manager to abandon the modal, go to Tasks, create it, then come back is friction. Adding the task inline keeps the scheduling flow uninterrupted.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`.
1. On any row, click **+** to open **New allocation** (or draw on a lane in Work mode).
2. Choose **Project** = *Acme Inc. / Project Lightning*. Once a project is chosen, an inline task field appears.
3. In the **…or add a new task** field (accessible name *New task name*), type `Accessibility Audit`.
4. Click **Add task**.
5. Fill the remaining fields (dates, Hours / day) and click **Save**.

## Acceptance criteria
- ✅ The inline task field (placeholder `…or add a new task`) only appears once a **Project** is selected.
- ✅ Typing a name and clicking **Add task** creates the task under the selected project and immediately selects it as the allocation's **Task** (the **Task** select now shows *Accessibility Audit*), and the input clears.
- ✅ The new task is a real task of that project — it appears on the **Tasks** page and in the **Task** dropdown afterwards.
- ✅ Clicking **Add task** with an empty name (or with no project selected) does nothing (no task created).
- ✅ Saving with the newly-added task selected creates an allocation bar labelled *Accessibility Audit*.
