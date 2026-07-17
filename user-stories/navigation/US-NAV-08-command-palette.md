# US-NAV-08 — Command palette (⌘K / Ctrl+K)

**Area:** Navigation · **Persona:** Studio manager · **Linked E2E:** `e2e/palette.spec.ts` → "fuzzy-finds a seeded resource and jumps to their lane"

## Goal
Open a keyboard-driven command palette to jump instantly to any person, project, page or date
without mousing through the sidebar.

## Why
The palette is for speed: CapacityLens is a helicopter view of who's busy. A single shortcut and a
couple of keystrokes navigate faster than any menu when you already know what you're looking for.

## How (end-to-end)

**Precondition:** Seeded app open at Schedule (`/`), Studio North tenant active.

1. Press **⌘K** (macOS) or **Ctrl+K** (Windows/Linux). The command palette opens centred near the top of the page. The search field is focused.
2. With no query, two sections appear: **Actions** ("Go to today") and **Pages** (all 9 sidebar routes, including **Team & access**, listed with their paths).
3. Type `Nix`. The palette shows a **People** section with *Tyler Nix* as the first result.
4. Press **ArrowDown** once, then **Enter** (or just click *Tyler Nix*). The palette closes.
5. The scheduler scrolls so Tyler Nix's row is visible.
6. Press **⌘K** again. Type `2026-06-10`. An **Actions** entry "Go to date 2026-06-10" appears.
7. Press **Enter**. The scheduler jumps to that week.
8. Press **⌘K** again. Type `res`. The *Resources* page option appears under **Pages**.
9. Press **Enter**. The app navigates to `/resources`.
10. Press **⌘K** to open the palette; press **Escape**. The palette closes without navigation.

## Acceptance criteria

- ✅ **⌘K / Ctrl+K** opens the palette from anywhere, including while a text field is focused (e.g. the scheduler's "Search people…" filter).
- ✅ A second **⌘K** toggles the palette closed.
- ✅ The search input receives focus on open.
- ✅ **Escape** and clicking the backdrop close the palette without navigating.
- ✅ The empty-query view shows **Actions** + **Pages** sections only.
- ✅ Typing filters all sections; non-matching sections are hidden.
- ✅ Typing a valid ISO date (`YYYY-MM-DD`) shows "Go to date YYYY-MM-DD" in **Actions**.
- ✅ Selecting a **Person** navigates to `/`, clears filters, and scrolls that resource's row into view.
- ✅ Selecting a **Project** navigates to `/` and sets the project filter.
- ✅ Selecting a **Client** navigates to `/` and sets the client filter.
- ✅ Selecting an **Activity** navigates to `/activities`.
- ✅ Selecting a **Page** navigates to that route.
- ✅ **ArrowUp/ArrowDown** move the highlight; **Enter** selects; mouse hover also sets the active item.
- ✅ The palette has no serious/critical WCAG 2.1 AA colour-contrast violations (axe test).
