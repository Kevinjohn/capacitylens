# US-RES-10 — The resource list display

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "favourites a person and keeps them first in the resource list and discipline group" · **Unit:** `src/components/resources/ResourceList.test.tsx` (list rows, favourite ordering and empty state)

## Goal

See every resource in a clear alphabetical roster, keep priority people at the top with a
favourite star, and get a useful empty state when there are none.

## Why

The Resources page is the manager's roster. It has to be scannable at a glance: who's on
the team, what they do and which leads need to stay prominent. When the team is empty it
should say so, not show a blank page.

## How (end-to-end)

**Precondition:** Seeded app open; click **Resources** in the sidebar.

1. Read the People list against the seed: Barry Allen, Bruce Wayne, Clark Kent and Diana Prince.
2. Click **Add Clark Kent to favourites**. The star fills yellow and Clark moves to the top.
3. Open **Schedule**. Within Development, Clark appears before Barry while the discipline
   groups keep their existing order.
4. (Empty-state check) In a clean profile with no resources, observe the empty message.

## Acceptance criteria

- ✅ Each row shows its discipline colour, display name and role without redundant hours-per-day text.
- ✅ Person and external-party rows expose an accessible favourite star to editors and owners;
  placeholder rows and viewer sessions do not.
- ✅ Favourite people lead the People list and their existing schedule discipline group.
  Multiple favourites remain alphabetical, and unfavouriting restores ordinary alphabetical order.
- ✅ **No "Temp" tag** renders for anyone — including the seeded freelancer _Barry Allen_
  (see US-RES-07 and `DECISIONS.md`).
- ✅ When placeholders are enabled, _Senior Designer_ shows a "Placeholder" badge and is
  labelled by its role; favourites never move it ahead of people.
- ✅ With no resources, the list shows the empty state **"No resources yet."** instead of rows.
