# US-FIL-08 — Filter by task (the task lens)

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "filters the schedule to a repeatable task (the task lens)" · "the task lens is mutually exclusive with the client / project lens"

## Goal
Show only the allocations of a chosen internal/repeatable task — or a whole kind — regardless of which project they sit on.

## Why
Beyond a client view and a project view, managers want a **task view**: "show me all design work" or "all internal time" across every project. Repeatable tasks (Design, Workshop) and internal tasks (Admin) are project-less, so they aren't reachable via the project/client dropdowns — they get their own lens.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Seed books *Design* (a repeatable task) for Alex on 8–10 June. The toolbar shows a **Filter by task** dropdown (grouped: *All tasks*; an *Internal* group with `Internal — All` + each internal task; a *Repeatable* group with `Repeatable — All` + each repeatable task).
1. Open **Filter by task** and choose **Repeatable — All**.
2. Note the schedule now shows only the *Design* booking.
3. Set **Filter by project** to **Brand Themes**, then re-open **Filter by task** and choose **Repeatable — All** again.

## Acceptance criteria
- ✅ Choosing **Repeatable — All** collapses the view to repeatable-task work only (the *Design* bar); project-task bars are hidden.
- ✅ The task lens is **standalone**: selecting a task filter resets **Filter by project / client** to *All*, and choosing a project/client resets **Filter by task** to *All tasks* (the two lenses are mutually exclusive).
- ✅ Project tasks are **not** listed in the task dropdown (they're reached via **Filter by project**).
- ✅ **Show unallocated** works under the task lens too (dimmed rows for resources with no matching task work).
- ✅ The dropdown is **absent** for an account with no internal/repeatable tasks.
