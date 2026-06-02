# US-ALL-07 — Placeholder assignee locks the project

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "snaps the project to a placeholder bound project when chosen" · `e2e/features.spec.ts` → "drawing on a placeholder locks the modal to its bound project"

## Goal
When the chosen Assignee is a placeholder, preset its bound project and restrict the Project choices to it (the bound project plus the general option) and limit tasks to that project, so a hiring slot's work can't drift onto another project.

## Why
A placeholder is a reserved slot for one project (e.g. *Senior Designer* on *Project Lightning*). Its allocations must stay attached to that project until a real person takes over. The modal enforces this so the manager can't accidentally book the slot onto unrelated work.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. The **Senior Designer** placeholder (`r-ph-designer`) is bound to **Project Lightning** (`p-acme`).
1. On the **Senior Designer** placeholder's row (shown on the schedule with its name in quotes — *"Senior Designer"* — and an `@` avatar), click **+** to open **New allocation** — or draw on its lane in Work mode. In create mode the assignee is fixed to that row (no Assignee select), so the modal opens already bound to the placeholder.
2. Observe the **Project** field.

## Acceptance criteria
- ✅ Opening on the placeholder's row sets **Project** to its bound project, *Acme Inc. / Project Lightning* (select value `p-acme`), and restricts the Project choices to that project plus *No project (general)* — the select stays **enabled** (a placeholder can still take general tasks); a non-bound project like *Brand Themes* is not offered.
- ✅ Only that project's tasks are offered in **Task** (e.g. *Wireframes*, *Visual Design*, *CMS Review*); *Brand System* is not selectable.
- ✅ A help line reads **"Placeholder — locked to its bound project."**
- ✅ Opening the modal by drawing directly on the placeholder's lane produces the same restricted state (Project preset to `p-acme` and its choices limited to the bound project plus the general option, the select still enabled).
- ✅ Because create mode has no Assignee select, the lock follows the row you opened from: to book a non-placeholder instead, open **+** from that resource's row (changing a placeholder's assignee in place is an edit-mode action — see US-ALL-06).
