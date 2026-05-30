# US-DIS-04 — Control discipline order (ties broken by name)

**Area:** Disciplines · **Persona:** Studio manager · **Linked E2E:** `e2e/disciplines.spec.ts` → "orders disciplines by sort order and falls back to name on a tie"

## Goal
Set the order disciplines appear in, via each discipline's **Sort order**, and have both the Disciplines list and the schedule grouping follow that same order — with equal sort orders broken alphabetically by name.

## Why
The manager wants the schedule to read top-to-bottom in a deliberate order (e.g. the busiest discipline first), and that order must be predictable. A single sort rule applied identically to the list and the schedule means there's no surprise about where a group lands.

## How (end-to-end)
**Precondition:** Seeded app open; click **Disciplines** in the sidebar (`/disciplines`). Seed orders are *Design* = 0, *Development* = 1, *Copywriting* = 2.
1. **Edit** *Copywriting* and set **Sort order** = `0`. Click **Save**.
2. **Edit** *Design* and leave **Sort order** = `0`. Click **Save**. (Now Copywriting and Design both have order `0`.)
3. **Edit** *Development* and set **Sort order** = `1`. Click **Save**.
4. Observe the Disciplines list order.
5. Click **Schedule** in the sidebar (`/`); use **Jump to date** → `2026-06-01`. Observe the group order.

## Acceptance criteria
- ✅ Disciplines sort ascending by **Sort order**: the two order-`0` disciplines come before the order-`1` *Development*.
- ✅ The two equal-order disciplines (*Copywriting* and *Design*, both `0`) fall back to **name**, so *Copywriting* sorts before *Design* alphabetically.
- ✅ Resulting order is **Copywriting, Design, Development** in the Disciplines list.
- ✅ The **schedule grouping order is identical** to the list order (Copywriting group, then Design group, then Development group).
- ✅ Changing any **Sort order** value reorders **both** surfaces consistently — the list and the schedule never disagree.
