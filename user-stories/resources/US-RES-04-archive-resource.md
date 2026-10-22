# US-RES-04 — Archive a resource (hide from the schedule) and restore

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "archiving a resource hides it from the list + schedule, and undo leaves it archived"

## Goal

Remove a resource from the schedule **reversibly** — archive it (with a clear warning), so its allocations and time off are retained and it can be restored
from the grouped archive sections below the Resources list.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`). Click **Today**
so the seed bars and time off are in view. **Bruce Wayne** has both allocations
(over-allocated on 3–4 June) and time off (10–12 June, Holiday).

1. Note that Bruce's row shows allocation bars and a hatched time-off block in early June.
2. Go to **Resources**; on the **Bruce Wayne** row click the **Archive Bruce Wayne** (trash) icon.
3. A dialog titled **"Archive resource?"** appears, naming Bruce and explaining the row will be hidden
   from the schedule and can be restored from the archive sections below the list.
4. Click **Cancel** first — the dialog closes and Bruce is still present (nothing archived).
5. Click the **Archive Bruce Wayne** icon again, then click **Archive** to confirm.
6. Go back to **Schedule** (click **Today** if needed) and observe Bruce is gone (hidden, not
   destroyed — his record + allocations + time off are retained).
7. Press **⌘Z**. Bruce stays archived: Undo and Redo currently cover booking changes only.

## Why

A departing or paused team member must be removed from the schedule cleanly, but a mis-click
shouldn't quietly destroy months of allocations and booked leave. Archiving is reversible: the data
stays, the row simply leaves the active views. Anonymising a person is a separate, irreversible
action; there is no permanent deletion.

## Acceptance criteria

- ✅ The confirm dialog is titled **"Archive resource?"**, names the resource, and explains it will be
  hidden from the schedule and is restorable from the appropriate Archived Studio, Archived Supplementary,
  Archived External or Archived placeholders group.
- ✅ Choosing **Cancel** leaves the resource, its bars and its time off untouched and visible.
- ✅ After confirming **Archive**, the **Bruce Wayne** row disappears from Resources, and on
  **Schedule** Bruce's row, allocation bars and time-off block are all hidden — but the records are
  **retained** (not cascade-deleted), and Bruce appears under the appropriate archive group.
- ✅ Pressing **⌘Z** leaves Bruce archived; **Restore** from the resource archive sections brings him
  back with all of his allocations and time off.
