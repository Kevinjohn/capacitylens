# US-DIS-04 — Disciplines use a predictable order on each surface

**Area:** Disciplines · **Persona:** Studio manager · **Linked E2E:** `e2e/alphabetical-management-lists.spec.ts` + `e2e/disciplines.spec.ts` · **Unit:** `src/components/disciplines/DisciplineList.test.tsx` + `src/store/selectors.extra.test.ts`

## Goal

Have disciplines appear alphabetically where they are managed, while the schedule keeps the deliberate operational group order assigned when disciplines are created.

## Why

The management list is for finding and editing a discipline, so alphabetical order is easiest to scan. The schedule is a planning surface whose stable group order is assigned **automatically** (a new discipline lands last) rather than hand-managed through a fiddly field. These surfaces therefore have intentionally different ordering rules.

## How (end-to-end)

**Precondition:** Seeded app open; click **Disciplines** in the sidebar (`/disciplines`). The seed's
schedule order is _Design_, _Development_, _Copywriting_; the management list opens as _Copywriting_,
_Design_, _Development_.

1. Click **Add discipline**, name it `Strategy`, pick a colour, and **Save**.
2. Confirm the management list reads _Copywriting_, _Design_, _Development_, _Strategy_.
3. Click **Schedule** in the sidebar (`/`); click **Today**. Confirm its existing group order remains _Design_, _Development_, _Copywriting_, _Strategy_.

## Acceptance criteria

- ✅ A discipline's sort order is **assigned automatically** — there is no Sort-order field in the discipline form.
- ✅ The Disciplines management list is alphabetical by displayed name.
- ✅ The schedule remains ordered by ascending `sortOrder`, with equal orders broken alphabetically by name; a new **Strategy** group therefore lands after the existing groups.
- ✅ Sorting the management view does not mutate stored discipline order or change the schedule grouping.
- ✅ Case, accent and exact-name ties use deterministic tie-breakers rather than relying on engine sort stability or the host locale.
