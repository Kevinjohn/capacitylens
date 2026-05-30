# US-ALL-07 — Placeholder assignee locks the project

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "locks the project when a placeholder assignee is chosen" · `e2e/features.spec.ts` → "drawing on a placeholder locks the modal to its bound project"

## Goal
When the chosen Assignee is a placeholder, force its bound project (disabled, preset) and limit tasks to that project, so a hiring slot's work can't drift onto another project.

## Why
A placeholder is a reserved slot for one project (e.g. *Senior Designer* on *Project Lightning*). Its allocations must stay attached to that project until a real person takes over. The modal enforces this so the manager can't accidentally book the slot onto unrelated work.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. The **Senior Designer** placeholder (`r-ph-designer`) is bound to **Project Lightning** (`p-acme`).
1. On any row, click **+** to open **New allocation** (or draw on a lane in Work mode).
2. Set **Assignee** to the placeholder *Senior Designer* (its option carries a ` (slot)` suffix).
3. Observe the **Project** field.

## Acceptance criteria
- ✅ Choosing the placeholder Assignee sets **Project** to its bound project, *Acme Inc. / Project Lightning* (select value `p-acme`), and **disables** the Project field.
- ✅ Only that project's tasks are offered in **Task** (e.g. *Wireframes*, *Visual Design*, *CMS Review*); *Brand System* is not selectable.
- ✅ A help line under Assignee reads **"Placeholder — locked to its bound project."**
- ✅ Opening the modal by drawing directly on the placeholder's lane produces the same locked state (Project disabled and preset to `p-acme`).
- ✅ Switching the Assignee back to a non-placeholder re-enables the Project field (it keeps the bound project as its value until you change it); Phase/Task are not auto-cleared.
