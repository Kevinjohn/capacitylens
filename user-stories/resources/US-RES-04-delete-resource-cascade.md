# US-RES-04 — Delete a resource (cascade) and undo

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "deleting a resource cascades to its allocations and time off, and undo restores them"

## Goal
Remove a resource and, with it, everything attached to that resource — its allocations and
its time off — with a clear warning and a one-step undo.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Use **Jump to date** → `2026-06-01`
so the seed bars and time off are in view. **Tyler Nix** has both allocations
(over-allocated on 3–4 June) and time off (10–12 June, Holiday).
1. Note that Tyler's row shows allocation bars and a hatched time-off block in early June.
2. Go to **Resources**; on the **Tyler Nix** row click **Delete**.
3. A dialog titled **"Delete resource?"** appears, warning that Tyler's allocations and time
   off will go too and stating "You can undo this with ⌘Z."
4. Click **Cancel** first — the dialog closes and Tyler is still present (nothing deleted).
5. Click **Delete** on the Tyler row again, then click **Delete** to confirm.
6. Go back to **Schedule** (Jump to `2026-06-01` if needed) and observe Tyler is gone.
7. Undo the delete — either press **⌘Z** or click the toolbar **Undo** button.

## Why
A departing team member must be removed cleanly, but a mis-click shouldn't quietly destroy
months of allocations and booked leave. The confirm-warn-undo flow makes the destructive
cascade safe.

## Acceptance criteria
- ✅ The confirm dialog is titled **"Delete resource?"**, names the resource, and warns the
  delete takes its allocations and time off and is undoable ("You can undo this with ⌘Z.").
- ✅ Choosing **Cancel** leaves the resource, its bars and its time off untouched.
- ✅ After confirming **Delete**, the **Tyler Nix** row disappears from Resources, and on
  **Schedule** Tyler's row, allocation bars and time-off block are all gone.
- ✅ Pressing **⌘Z** restores Tyler together with **all** of his allocations and time off.
