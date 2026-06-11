# US-RES-10 — The resource list display

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "adds a person and shows them in the list and schedule" · **Unit:** `src/components/resources/ResourceList.test.tsx` (list rows: avatar, role, tags, empty state)

## Goal
See every resource in one list, each with a colour avatar of their initials and their role —
and a clear empty state when there are none.

## Why
The Resources page is the manager's roster. It has to be scannable at a glance: who's on
the team and what they do. When the team is empty it should say so, not show a blank page.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. Read the list against the seed: Tyler Nix, Pam Gonzalez, Nike Spiros, Alex Rivera, and
   the *Senior Designer* placeholder.
2. Check each row's avatar, role and any tag.
3. (Empty-state check) In a clean profile with no resources, observe the empty message.

## Acceptance criteria
- ✅ Each row shows a colour avatar whose **initials match the name** (e.g. *Tyler Nix* → *TN*).
- ✅ Each row shows the resource's **role** and working hours (e.g. *Designer · 8h/day*).
- ✅ **No "Temp" tag** renders for anyone — including the seeded freelancer *Alex Rivera*
  (the pill is parked; see US-RES-07 and `NEEDS-INPUT.md` → "Parked").
- ✅ The placeholder (*Senior Designer*) shows a "placeholder" tag and is labelled by its
  role (it has no name).
- ✅ With no resources, the list shows the empty state **"No resources yet."** instead of rows.
