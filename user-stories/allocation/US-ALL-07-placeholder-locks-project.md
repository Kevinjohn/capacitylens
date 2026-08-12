# US-ALL-07 — Placeholder assignee locks the project

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "snaps the project to a placeholder bound project when chosen" · `e2e/features.spec.ts` → "drawing on a placeholder locks the modal to its bound project"

## Goal

When the chosen Assignee is a placeholder, preset its bound project and restrict the Project choices to it (the bound project plus Internal and Any Project) and limit activities to the chosen scope, so a hiring slot's work can't drift onto another project.

## Why

A placeholder is a reserved slot for one project (e.g. _Senior Designer_ on _Project Watchtower_). Its allocations must stay attached to that project until a real person takes over. The modal enforces this so the manager can't accidentally book the slot onto unrelated work.

## How (end-to-end)

**Precondition:** Seeded app open. In **Settings**, enable **Show placeholders**, then return to
**Schedule** (`/`), set **Weeks visible** to **4 weeks**, and click **Today**. The **Senior
Designer** placeholder (`r-ph-designer`) is bound to **Project Watchtower** (`p-acme`).

1. On the seeded **Senior Designer** placeholder's row (shown on the schedule as the literal **Placeholder** with a `?` avatar), click **+** to open **New allocation** — or draw on its lane in Work mode. In create mode the assignee is fixed to that row (no Assignee select), so the modal opens already bound to the placeholder.
2. Observe the **Project** field.

## Acceptance criteria

- ✅ Opening on the placeholder's row sets **Project** to its bound project, _Queen Consolidated / Project Watchtower_ (select value `p-acme`), and restricts the Project choices to that project plus _Internal_ and _Any Project_ — the select stays **enabled** (a placeholder can still take project-less activities); a non-bound project like _Metropolis Rebrand_ is not offered.
- ✅ Only that project's activities are offered in **Activity** (e.g. _Wireframes_, _Visual Design_, _CMS Review_); _Brand System_ is not selectable.
- ✅ A help line reads **"Placeholder — locked to its bound project."**
- ✅ Opening the modal by drawing directly on the placeholder's lane produces the same restricted state (Project preset to `p-acme` and its choices limited to the bound project plus Internal and Any Project, the select still enabled).
- ✅ Because create mode has no Assignee select, the lock follows the row you opened from: to book a non-placeholder instead, open **+** from that resource's row (changing a placeholder's assignee in place is an edit-mode action — see US-ALL-06).
