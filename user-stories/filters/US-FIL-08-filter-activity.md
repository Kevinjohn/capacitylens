# US-FIL-08 — Filter by activity (the activity lens)

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "filters the schedule to a repeatable activity (the activity lens)" · "the activity lens is mutually exclusive with the client / project lens"

## Goal
Show only the allocations of a chosen internal/repeatable activity — or a whole kind — regardless of which project they sit on.

## Why
Beyond a client view and a project view, managers want an **activity view**: "show me all design work" or "all internal time" across every project. Repeatable activities (Design, Workshop) and internal activities (Admin) are project-less, so they aren't reachable via the project/client dropdowns — they get their own lens.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Seed books *Design* (a repeatable activity) for Alex on 8–10 June. The toolbar shows a **Filter by activity** dropdown (grouped: *All activities*; an *Internal* group with `Internal — All` + each internal activity; a *Repeatable* group with `Repeatable — All` + each repeatable activity).
1. Open **Filter by activity** and choose **Repeatable — All**.
2. Note the schedule now shows only the *Design* booking.
3. Set **Filter by project** to **Brand Themes**, then re-open **Filter by activity** and choose **Repeatable — All** again.

## Acceptance criteria
- ✅ Choosing **Repeatable — All** collapses the view to repeatable-activity work only (the *Design* bar); project-activity bars are hidden.
- ✅ The activity lens is **standalone**: selecting an activity filter resets **Filter by project / client** to *All*, and choosing a project/client resets **Filter by activity** to *All activities* (the two lenses are mutually exclusive).
- ✅ Project activities are **not** listed in the activity dropdown (they're reached via **Filter by project**).
- ✅ **Show unallocated** works under the activity lens too (dimmed rows for resources with no matching activity work).
- ✅ The dropdown is **absent** for an account with no internal/repeatable activities.
