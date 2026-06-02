# US-SCH-17 — Quick-create an allocation from a row's "+" button

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "creates an allocation from the row + button (assignee preselected)"

## Goal
Click a resource row's "+" button to open a "New allocation" modal already fixed to that resource (their name in the dialog title — there is no Assignee field to choose in row-create mode).

## Why
Drawing on the lane (US-SCH-02) is great when you know exactly which days you want; sometimes the manager just knows *who* and wants to book them quickly without aiming a drag. The row "+" is that shortcut — one click, the right person already selected, then pick the project, task and dates. It removes the most error-prone step (choosing the right assignee) by carrying the row's identity into the form.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`).
1. On a resource row (e.g. **Tyler Nix**), click its **"+"** button (labelled "Add allocation for Tyler Nix" / titled "Add allocation").
2. A **"New allocation"** modal opens, titled **"New allocation for Tyler Nix"**.
3. Confirm the assignee is fixed to that row's resource (**Tyler Nix**) — named in the dialog title, with **no Assignee select** to change (the row "+" already chose them).
4. The Start/End dates are prefilled (see US-SCH-18 for which date) — pick a **Project** and **Task** and **Save** to book it.

## Acceptance criteria
- ✅ Clicking a row's **"+"** opens the **"New allocation"** modal.
- ✅ The modal is fixed to that row's resource (e.g. **Tyler Nix**), named in the dialog title — there is **no Assignee select** in row-create mode.
- ✅ The flow lets you complete the booking for that person (project + task + save) without re-choosing the assignee.
