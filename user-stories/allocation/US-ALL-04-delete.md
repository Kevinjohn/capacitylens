# US-ALL-04 — Delete an allocation

**Area:** Allocation editor · **Persona:** Studio manager · **Linked tests:**
`e2e/allocation.spec.ts` → "deletes an allocation from the edit dialog and ⌘Z restores it" ·
`e2e/features.spec.ts` → "undo restores a deleted allocation" ·
`src/components/scheduler/AllocationModal.test.tsx`

## Goal

Remove a single allocation from the schedule, and be able to undo that removal.

## Why

Bookings get cancelled. The manager needs a clear way to remove one allocation, a confirmation step
that prevents an accidental click, and undo in case the confirmed removal was still a mistake.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`); set **Weeks visible** to **4 weeks** and click **Today** so the seed bars are in view. The seed has a _Brand System_ bar (on **Diana Prince**).

1. Click the **Brand System** bar. The **Edit allocation** dialog opens.
2. Click **Delete**. A **Delete allocation?** confirmation dialog opens.
3. Click **Cancel**. The confirmation closes, the editor stays open, and the bar remains unchanged.
4. Click **Delete** again, then click **Delete** in the confirmation dialog. The editor closes and
   the bar disappears.
5. Press **⌘Z** (Undo).

## Acceptance criteria

- ✅ The confirmation dialog is titled **Delete allocation?** with **Delete** and **Cancel** buttons.
- ✅ **Cancel** keeps the exact allocation and returns to its open editor.
- ✅ After confirming **Delete**, the **Brand System** bar is gone and the total `allocation-bar`
  count drops by one.
- ✅ If the removal is rejected, the dialog remains open and shows the safe rejection reason.
- ✅ Pressing **⌘Z** restores the exact same bar (same resource, activity, dates, hours and status).
- ✅ The delete is undoable via **⌘Z** OR the toolbar **Undo** button — either path restores the bar.
