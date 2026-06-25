# US-CLI-03 — Delete a client (cascade; placeholders unbound, not deleted)

**Area:** Clients · **Persona:** Studio manager · **Linked E2E:** `e2e/clients.spec.ts` → "deletes a client and cascades to its projects, restorable with undo"

## Goal
Remove a client and have everything underneath it (its projects → activities → allocations) go with it, while any placeholder bound to one of those projects is **unbound but kept**.

## Why
When an account ends, the manager wants a clean sweep of that client's work in one action — not hunting down each project, activity and bar by hand. But a placeholder represents a *role to hire*, not the client's data, so it must survive (just unbound). Because this is destructive, the action is undoable.

## How (end-to-end)
**Precondition:** Seeded app open; click **Clients** in the sidebar (`/clients`). *Acme Inc.* owns **Project Lightning**, which has activities (*Wireframes*, *Visual Design*, *CMS Review*) and allocations, and the **Senior Designer** placeholder (`r-ph-designer`) is bound to Project Lightning.
1. On the **Acme Inc.** row, click the **Delete** (trash) icon. The "Delete client?" confirmation dialog opens.
2. Read the dialog: it warns the action cascades and is undoable — "You can undo this with ⌘Z."
3. Click **Delete** to confirm. The dialog closes.
4. Visit **Projects**, **Activities**, and **Resources**, and the **Schedule** (`/`, **Jump to date** → `2026-06-01`) to inspect the result.
5. Press **⌘Z** (Undo) to reverse the deletion.

## Acceptance criteria
- ✅ The confirmation dialog is titled **Delete client?** and warns the delete cascades and is undoable ("You can undo this with ⌘Z.").
- ✅ After confirming, **Acme Inc.** is gone from the Clients list.
- ✅ **Project Lightning** is gone from Projects; its activities (*Wireframes*, *Visual Design*, *CMS Review*) are gone from Activities; their allocation bars are gone from the schedule.
- ✅ The **Senior Designer** placeholder still exists as a resource — it is now **unbound** (no longer bound to Project Lightning), **not deleted**.
- ✅ *Globex* / *Brand Themes* and their activities/allocations are untouched.
- ✅ Pressing **⌘Z** restores the client, its projects, activities and allocations, and re-binds the **Senior Designer** placeholder to Project Lightning.
