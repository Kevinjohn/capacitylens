# US-FIL-08 — Filter by activity (the activity lens)

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "filters the schedule to an all-projects activity (the activity lens)" · "the activity lens is mutually exclusive with the client / project lens"

## Goal

Show only the allocations of a chosen internal/All-projects activity — or a whole kind — regardless of which project context the work belongs to.

## Why

Beyond a client view and a project view, managers want an **activity view**: "show me all design work" or "all internal time" across every project. All-projects activities (Design, Workshop) and internal activities (Admin) get their own lens. An attributed All-projects allocation can match either its activity lens or its chosen project/client lens; selecting one lens still clears the other.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`); click **Show filters**. Seed books _Design_ (an unattributed All-projects activity) for Barry on 8–10 June. The expanded row shows a **Filter by activity** dropdown (grouped: _All activities_; an _Internal_ group with `Internal — All` + each internal activity; an _All projects_ group with `All projects — All` + each All-projects activity).

1. Open **Filter by activity** and choose **All projects — All**.
2. Note the schedule now shows only the _Design_ booking.
3. Set **Filter by project** to **Metropolis Rebrand**, then re-open **Filter by activity** and choose **All projects — All** again.

## Acceptance criteria

- ✅ Choosing **All projects — All** collapses the view to All-projects activity work only (the _Design_ bar); project-specific activity bars are hidden.
- ✅ Internal remains above All projects, and activities are alphabetical within each group after
  the group's **All** option.
- ✅ The activity lens is **standalone**: selecting an activity filter resets **Filter by project / client** to _All_, and choosing a project/client resets **Filter by activity** to _All activities_ (the two lenses are mutually exclusive).
- ✅ Project-specific activities are **not** listed in the activity dropdown (they're reached via **Filter by project**).
- ✅ **Show unallocated** works under the activity lens too (dimmed rows for resources with no matching activity work).
- ✅ The dropdown is **absent** for an account with no internal/All-projects activities.
