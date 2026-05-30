# US-NAV-06 — Automatic dark mode (and reduced motion)

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked E2E:** `e2e/navigation.spec.ts` → "follows the OS dark setting and re-themes every surface"

## Goal
Have Floaty match the OS/browser light-or-dark setting automatically, with legible
text in both, and honour a reduced-motion preference — no manual theme toggle.

## Why
People schedule at all hours and on systems configured for dark mode at night. Floaty
themes from semantic colour tokens that flip on `prefers-color-scheme`, so the whole UI
re-themes at once and stays readable (WCAG AA), with no per-component dark styling to
drift out of sync. Respecting `prefers-reduced-motion` also keeps it comfortable for
users who disable animations.

## How (end-to-end)
**Precondition:** Seeded app open at Schedule (`/`).
1. Set your OS (or the browser) to **dark** appearance. In Chrome DevTools you can
   instead use *Rendering → Emulate CSS media feature `prefers-color-scheme: dark`*.
2. Without reloading or toggling anything in-app, the UI re-themes to dark: sidebar,
   the schedule grid, list pages, modals, banners and toasts all switch surfaces.
3. Check legibility: nav labels, the **Load · next 2w** column, resource names, list
   text and form labels all read clearly against the dark surfaces.
4. Open a modal (e.g. **Resources → Add resource**) and confirm its panel, labels and
   the primary button are legible in dark.
5. (Reduced motion) Enable *Emulate prefers-reduced-motion: reduce* (or the OS setting)
   and confirm entrance animations (modal pop, toast) are suppressed/instant.
6. Switch the setting back to light — the UI returns to the light theme automatically.

## Acceptance criteria
- ✅ Switching the OS/browser to dark re-themes every surface (sidebar, grid, lists,
  modals, banner, toast) with no manual toggle and no reload.
- ✅ Text on every re-themed surface remains legible (meets WCAG AA contrast).
  (The axe oracle proves this on the grid and a modal — see US-KBD-04.)
- ✅ Switching back to light restores the light theme automatically.
- ✅ With `prefers-reduced-motion: reduce`, entrance animations are suppressed/instant.
