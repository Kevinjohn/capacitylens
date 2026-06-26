# US-CLI-03 — Archive a client (hide from the schedule) and undo

**Area:** Clients · **Persona:** Studio manager · **Linked E2E:** `e2e/clients.spec.ts` → "archiving a client hides it from the list, restorable with undo"

## Goal
Remove a client from the active views **reversibly** — archive it (with a clear warning and one-step
undo) so the client and everything underneath it (its projects → activities → allocations) are
retained and can be restored, or later permanently deleted from Settings → Archived & deleted.

## Why
When an account pauses or ends, the manager wants the client off the schedule in one action — but
without destroying months of work. Archiving hides the client from the active views while retaining
its data; soft-delete and permanent removal (which DO cascade to children) are separate, later steps
reached from Settings → Archived & deleted. Because archiving is reversible, the action is undoable.

## How (end-to-end)
**Precondition:** Seeded app open; click **Clients** in the sidebar (`/clients`). *Acme Inc.* owns
**Project Lightning**, which has activities (*Wireframes*, *Visual Design*, *CMS Review*) and
allocations.
1. On the **Acme Inc.** row, click the **Archive Acme Inc.** (trash) icon. The "Archive client?"
   confirmation dialog opens.
2. Read the dialog: it explains the client's work will be hidden from the schedule and can be restored
   or permanently deleted from **Settings → Archived & deleted**.
3. Click **Archive** to confirm. The dialog closes and **Acme Inc.** leaves the Clients list.
4. Press **⌘Z** (Undo, LOCAL mode) to reverse the archive — Acme Inc. returns to the Clients list.

## Acceptance criteria
- ✅ The confirmation dialog is titled **Archive client?** and explains the client is hidden from the
  schedule and is restorable from Settings → Archived & deleted.
- ✅ After confirming, **Acme Inc.** is gone from the Clients management list (archived, not destroyed).
- ✅ The client, its projects, activities and allocations are **retained** in the data — archiving
  filters each row by its OWN status (it does not cascade-delete the children), so a project under the
  archived client keeps its own active status.
- ✅ Archived clients surface in **Settings → Archived & deleted**, where they can be restored or
  (after soft-delete + the 30-day grace) permanently deleted.
- ✅ (LOCAL mode) Pressing **⌘Z** restores the client to the active list; in server mode, **Restore**
  from Settings → Archived & deleted brings it back.
