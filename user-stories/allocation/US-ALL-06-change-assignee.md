# US-ALL-06 — Change an allocation's assignee

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "reassigns an allocation to another resource via the dialog"

## Goal
Reassign an existing allocation to a different resource from the edit dialog, moving its bar to that resource's row.

## Why
Work gets handed over — someone goes on leave, a freelancer takes a task, or a placeholder is filled by a real hire. The manager needs to reassign a booking without recreating it, preserving its dates, hours, status and note.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. The seed has a *Brand System* bar on the **Nike Spiros** row.
1. Click the **Brand System** bar. The **Edit allocation** dialog opens with **Assignee** = *Nike Spiros*.
2. Change **Assignee** to *Alex Rivera*.
3. Click **Save**. The dialog closes.

## Acceptance criteria
- ✅ After Save, the **Brand System** bar no longer appears on the **Nike Spiros** row and now appears on the **Alex Rivera** row (`data-resource-id="r-alex"`).
- ✅ The bar keeps its task, dates, hours/day, status and note — only the resource changed.
- ✅ Pressing **⌘Z** moves the bar back to **Nike Spiros**.
- ✅ Selecting a placeholder as the new Assignee locks Project to its bound project and clears Task — you must pick one of that project's tasks before Save (see US-ALL-07).
