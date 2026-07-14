# US-PRJ-01 — Add a project (must belong to a client)

**Area:** Projects · **Persona:** Studio manager · **Linked E2E:** `e2e/projects.spec.ts` → "rejects a project without a client and adds one with a client"

## Goal
Add a new project under a client so it can be scheduled, filtered and allocated against — and confirm a project cannot be saved without a client.

## Why
A project is meaningless without an owning client; that invariant keeps the whole hierarchy (client → project → activity → allocation) intact. The manager creates a project once, after which it shows up wherever work is planned.

## How (end-to-end)
**Precondition:** Seeded app open; click **Projects** in the sidebar (`/projects`). Clients *Acme Inc.* and *Globex* exist.
1. Click **Add project**. The "Add project" dialog opens.
2. Fill **Name** = `Spring Campaign` but leave **Client** unset.
3. Click **Save** — observe it is rejected.
4. Now choose **Client** = *Globex*.
5. Open **Colour** and pick a swatch from the preset grid.
6. Click **Save**. The dialog closes.
7. Open the **Schedule** (`/`) and **Filter by project**; and start an allocation to check the **Project** picker.

## Acceptance criteria
- ✅ Saving with **Client** unset keeps the dialog open and shows the error **"A project must belong to a client."** (an `alert`).
- ✅ After choosing *Globex* and Save, the dialog closes and **Spring Campaign** appears in the Projects list with its "Client / Project" label showing *Globex*.
- ✅ **Spring Campaign** is selectable in the schedule's **Filter by project**.
- ✅ When allocating, **Spring Campaign** is selectable in the **Project** picker.
- ✅ Saving with an empty **Name** is also rejected (required-field error, dialog stays open).
