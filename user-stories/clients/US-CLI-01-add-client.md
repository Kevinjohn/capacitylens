# US-CLI-01 — Add a client

**Area:** Clients · **Persona:** Studio manager · **Linked E2E:** `e2e/clients.spec.ts` → "adds a client and makes it available as a schedule filter"

## Goal
Add a new client (name and colour) so projects can be created under it and the schedule can be filtered to it.

## Why
Clients are the top of the work hierarchy: every project belongs to one. Onboarding a client once unlocks creating their projects and lets the manager slice the schedule down to just that client's work when reviewing a single account.

## How (end-to-end)
**Precondition:** Seeded app open; click **Clients** in the sidebar (`/clients`). The list shows *Acme Inc.* and *Globex*.
1. Click **Add client**. The "Add client" dialog opens.
2. Fill **Name** = `Initech`.
3. Open **Colour** and pick a swatch from the preset grid.
4. Click **Save**. The dialog closes.
5. Click **Projects** in the sidebar, click **Add project**, and open the **Client** picker.
6. Click **Schedule** in the sidebar (`/`) and open **Filter by client**.

## Acceptance criteria
- ✅ After Save, the dialog closes and a row for **Initech** appears in the Clients list with its colour swatch.
- ✅ When creating a project, **Initech** is selectable in the **Client** picker.
- ✅ On the **Schedule**, **Initech** is an option in **Filter by client**.
- ✅ Saving with an empty **Name** keeps the dialog open and shows an inline required-field error (`aria-invalid` on Name).
- ✅ The **Colour** picker offers only preset swatches, so a saved colour is always a valid 6-digit `#rrggbb`.
