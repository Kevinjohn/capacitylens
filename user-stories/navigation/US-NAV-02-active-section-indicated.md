# US-NAV-02 — Current section is indicated in the nav

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked E2E:** `e2e/navigation.spec.ts` → "the active section is highlighted and only one at a time"

## Goal
See at a glance which section is open, so it's obvious where you are in the app.

## Why
Without a clear "you are here" marker, a manager can lose track of which list they're
editing and make a change on the wrong screen. The active link is styled distinctly
(brand-soft background + semibold ink) and exactly one link is active at any moment.

## How (end-to-end)
**Precondition:** Seeded app open at Schedule (`/`).
1. Note the **Schedule** link: it has the brand-soft background and semibold weight
   (the other links are plain with a hover background only).
2. Click **Clients**. The **Clients** link now takes the active styling.
3. Confirm **Schedule** has dropped back to the plain (inactive) style.
4. Click **Tasks**. The active styling moves to **Tasks**; **Clients** reverts to plain.
5. At each step, scan the whole sidebar: only one link is in the active state.

## Acceptance criteria
- ✅ The link matching the current route is active: brand-soft background
  (`bg-brand-soft`) and semibold text (`font-semibold`).
- ✅ Inactive links use the plain style (no brand-soft background; hover only).
- ✅ Clicking a link moves the active styling to it and clears it from the previous link.
- ✅ Exactly one link is active at a time (never zero, never two).
- ✅ The **Schedule** link is active only on `/` exactly — visiting `/resources` does
  not leave **Schedule** highlighted (the `end` match on the root route).
