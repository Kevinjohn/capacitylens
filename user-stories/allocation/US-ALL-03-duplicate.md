# US-ALL-03 — Duplicate an allocation

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "duplicates an allocation from the edit dialog"

## Goal
Create a second identical allocation from an existing one in a single click, so repeated bookings don't have to be re-entered field by field.

## Why
Studios often repeat a booking — the same person on the same activity for the same window again, or a quick copy to tweak. Duplicating from the edit dialog is faster and less error-prone than re-keying every field.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. Note the current count of bars on the **Tyler Nix** row.
1. Click the **Wireframes** bar. The **Edit allocation** dialog opens.
2. Click **Duplicate**. The dialog closes immediately (no confirmation).

## Acceptance criteria
- ✅ After Duplicate, a second bar exists for the same resource, same activity, same dates, same hours/day and same status as the original.
- ✅ The total number of `allocation-bar` elements on that resource's row increases by exactly one.
- ✅ The original bar is unchanged (Duplicate copies; it does not move or edit the source).
- ✅ The duplicate is itself an independent allocation — editing or deleting it does not affect the original.
- ✅ Pressing **⌘Z** removes the duplicate (the action is undoable).
