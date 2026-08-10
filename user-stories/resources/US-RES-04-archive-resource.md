# US-RES-04 — Archive a resource (hide from the schedule) and undo

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "archiving a resource hides it from the list + schedule, and undo restores it"

## Goal

Remove a resource from the schedule **reversibly** — archive it (with a clear warning and one-step
undo), so its allocations and time off are retained and it can be restored or, later, permanently
deleted from Settings → Archived & deleted.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`). Click **Today**
so the seed bars and time off are in view. **Bruce Wayne** has both allocations
(over-allocated on 3–4 June) and time off (10–12 June, Holiday).

1. Note that Bruce's row shows allocation bars and a hatched time-off block in early June.
2. Go to **Resources**; on the **Bruce Wayne** row click the **Archive Bruce Wayne** (trash) icon.
3. A dialog titled **"Archive resource?"** appears, naming Bruce and explaining the row will be hidden
   from the schedule and can be restored or permanently deleted from **Settings → Archived & deleted**.
4. Click **Cancel** first — the dialog closes and Bruce is still present (nothing archived).
5. Click the **Archive Bruce Wayne** icon again, then click **Archive** to confirm.
6. Go back to **Schedule** (click **Today** if needed) and observe Bruce is gone (hidden, not
   destroyed — his record + allocations + time off are retained).
7. Undo the archive — either press **⌘Z** or click the toolbar **Undo** button (LOCAL mode) — and
   Bruce reappears on the list and schedule.

## Why

A departing or paused team member must be removed from the schedule cleanly, but a mis-click
shouldn't quietly destroy months of allocations and booked leave. Archiving is reversible: the data
stays, the row simply leaves the active views. Soft-delete (which anonymises) and permanent removal
are deliberately separate, later steps reached from Settings → Archived & deleted — so the
confirm-warn-undo flow here is safe.

## Acceptance criteria

- ✅ The confirm dialog is titled **"Archive resource?"**, names the resource, and explains it will be
  hidden from the schedule and is restorable from Settings → Archived & deleted.
- ✅ Choosing **Cancel** leaves the resource, its bars and its time off untouched and visible.
- ✅ After confirming **Archive**, the **Bruce Wayne** row disappears from Resources, and on
  **Schedule** Bruce's row, allocation bars and time-off block are all hidden — but the records are
  **retained** (not cascade-deleted), and Bruce appears under Settings → Archived & deleted.
- ✅ (LOCAL mode) Pressing **⌘Z** restores Bruce (back to active) with all of his allocations and
  time off; in server mode, **Restore** from Settings → Archived & deleted brings him back.
