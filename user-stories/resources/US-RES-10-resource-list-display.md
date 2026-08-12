# US-RES-10 — The resource list display

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "groups Studio before Supplementary and restores one People order when disabled" · **Unit:** `src/components/resources/ResourceList.test.tsx` (engagement sections, favourite ordering and empty state)

## Goal

See every resource in a clear engagement-grouped roster, keep priority people at the top of their
Studio or Supplementary section with a favourite star, and get a useful empty state when there are
none.

## Why

The Resources page is the manager's roster. It has to be scannable at a glance: who's on
the team, what they do and which leads need to stay prominent. When the team is empty it
should say so, not show a blank page.

## How (end-to-end)

**Precondition:** Seeded app open; click **Resources** in the sidebar.

1. Confirm the default **Studio** and **Supplementary** sections are separate.
2. Click **Add Clark Kent to favourites**. The star fills yellow and Clark moves to the top of his
   engagement section.
3. Open **Schedule**. Within Development, Clark appears before Barry while the discipline
   groups keep their existing order.
4. (Empty-state check) In a clean profile with no resources, observe the empty message.

## Acceptance criteria

- ✅ Each row shows its discipline colour, display name and role without redundant hours-per-day
  text. A missing or dangling discipline is omitted from the metadata instead of rendering a stray
  em dash or separator.
- ✅ Person and external-party rows expose an accessible favourite star to editors and owners;
  placeholder rows and viewer sessions do not.
- ✅ With **Group resources by engagement** on (the default), Studio and Supplementary render as
  separate sections. Favourites lead only their own engagement section; every partition remains
  alphabetical.
- ✅ Turning the setting off restores one People list ordered favourites first and then
  alphabetically.
- ✅ **No "Temp" tag** renders for anyone — including the seeded freelancer _Barry Allen_
  (see US-RES-07 and `DECISIONS.md`).
- ✅ When placeholders are enabled, _Senior Designer_ shows a "Placeholder" badge and is
  labelled by its role; favourites never move it ahead of people.
- ✅ With no resources, the list shows the empty state **"No resources yet."** instead of rows.
