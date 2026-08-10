# US-CLI-02 — Edit a client

**Area:** Clients · **Persona:** Studio manager · **Linked E2E:** `e2e/clients.spec.ts` → "edits a client and the rename reflects in project labels"

## Goal

Change a client's name and colour and have the change reflected everywhere the client is referenced — including the "Client / Project" labels on its projects.

## Why

Clients rebrand, merge or get renamed. A single edit must ripple to every project label and filter so the studio never sees a stale or wrong client name against live work.

## How (end-to-end)

**Precondition:** Seeded app open; click **Clients** in the sidebar (`/clients`). _Queen Consolidated_ owns _Project Watchtower_.

1. On the **Queen Consolidated** row, click the **Edit** (pencil) icon. The dialog opens pre-filled.
2. Change **Name** = `Queen Industries`.
3. Change the **Colour** by opening it and picking a different swatch.
4. Click **Save**. The dialog closes.
5. Click **Projects** in the sidebar and find **Project Watchtower**.
6. Click **Schedule** in the sidebar (`/`) and open **Filter by client**.

## Acceptance criteria

- ✅ The Clients list row now reads **Queen Industries** with the new colour swatch.
- ✅ On the Projects screen, **Project Watchtower** now shows the client as **Queen Industries** in its "Client / Project" label.
- ✅ On the **Schedule**, **Filter by client** now lists **Queen Industries** (not "Queen Consolidated").
- ✅ The rename does not alter Project Watchtower's own data (its phases, activities and allocations are unchanged).
- ✅ Clearing **Name** to empty and clicking **Save** is rejected (required-field error, dialog stays open).
