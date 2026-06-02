# US-NAV-06 — Light / dark theme preference (and reduced motion)

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked E2E:** `e2e/navigation.spec.ts` → "settings toggles the colour theme", "renders in dark mode"; `e2e/a11y.spec.ts` → "scheduler in dark mode has no serious or critical violations"

## Goal
Choose Floaty's colour scheme in **Settings** — **Light** (the default), **Dark**, or
**Match system** (follow the OS) — with legible text in every theme, and have a
reduced-motion preference honoured.

## Why
People schedule at all hours, and some prefer a dark UI at night. Floaty themes from
semantic colour tokens resolved to one `data-theme` on `<html>`, so the whole UI
re-themes at once and stays readable (WCAG AA), with no per-component dark styling to
drift out of sync. The default is **light**; dark is an explicit opt-in (or "Match
system", which tracks the OS), so nothing surprises a user who hasn't asked for it.
Respecting `prefers-reduced-motion` also keeps it comfortable for users who disable
animations.

## How (end-to-end)
**Precondition:** Seeded app open at Schedule (`/`). On a fresh profile the theme is
**light** by default — the app does not switch to dark just because the OS is dark.
1. Open **Settings** (sidebar) and find the **Appearance** section with a **Theme**
   choice: **Light**, **Dark**, **Match system** (Light is selected by default).
2. Click **Dark**. The whole UI re-themes to dark immediately — sidebar, the schedule
   grid, list pages, modals, banners and toasts all switch surfaces (no reload).
3. Check legibility: nav labels, the utilisation column, resource names, list text and
   form labels all read clearly against the dark surfaces.
4. Open a modal (e.g. **Resources → Add resource**) and confirm its panel, labels and
   the primary button are legible in dark.
5. Click **Light** — the UI returns to the light theme. Then click **Match system**: the
   theme now follows the OS appearance and flips live if you change the OS setting.
6. (Reduced motion) Enable *Emulate prefers-reduced-motion: reduce* (or the OS setting)
   and confirm entrance animations (modal pop, toast) are suppressed/instant.

## Acceptance criteria
- ✅ On a fresh profile the default theme is **light** (`<html data-theme="light">`); the
  app does **not** auto-switch to dark from the OS setting alone.
- ✅ **Settings → Appearance** offers **Light**, **Dark** and **Match system**; choosing
  one re-themes every surface (sidebar, grid, lists, modals, banner, toast) immediately,
  with no reload.
- ✅ With **Match system** selected, the theme follows the OS appearance (and re-themes
  live when the OS scheme changes).
- ✅ Text on every re-themed surface remains legible (meets WCAG AA contrast).
  (The axe oracle proves this on the grid and a modal — see US-KBD-04.)
- ✅ With `prefers-reduced-motion: reduce`, entrance animations are suppressed/instant.
