# US-NAV-06 — Light / dark theme preference (and reduced motion)

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked E2E:** `e2e/navigation.spec.ts` → "settings toggles the colour theme", "sidebar toggles between light and dark mode", "renders in dark mode"; `e2e/a11y.spec.ts` → "scheduler in dark mode has no serious or critical violations"

**Documentation:** [Settings](../../docs-src/guide/settings.md)

## Goal

Switch quickly between light and dark from the sidebar, or choose the full colour-scheme
preference in **Settings** — **Light** (the default), **Dark**, or **Match system** (follow the
OS) — with legible text in every theme, and have a reduced-motion preference honoured.

## Why

People schedule at all hours, and some prefer a dark UI at night. CapacityLens themes from
semantic colour tokens resolved to one `data-theme` on `<html>`, so the whole UI
re-themes at once and stays readable (WCAG AA), with no per-component dark styling to
drift out of sync. The default is **light**; dark is an explicit opt-in (or "Match
system", which tracks the OS), so nothing surprises a user who hasn't asked for it.
Respecting `prefers-reduced-motion` also keeps it comfortable for users who disable
animations.

## How (end-to-end)

**Precondition:** Seeded app open at Schedule (`/`). On a fresh profile the theme is
**light** by default — the app does not switch to dark just because the OS is dark.

1. Below **Settings** in the sidebar, activate **Switch to dark mode**. The whole UI re-themes to
   dark immediately — sidebar, the schedule grid, lists, modals, banners and toasts all switch
   surfaces (no reload). The action becomes **Switch to light mode**.
2. Activate **Switch to light mode** to return to light, then open **Settings** and find the
   **Appearance on this device** row in **My display** with a **Theme** choice: **Light**, **Dark**,
   **Match system**.
3. Click **Dark**. The whole UI re-themes to dark immediately — sidebar, the schedule
   grid, list pages, modals, banners and toasts all switch surfaces (no reload).
4. Check legibility: nav labels, the utilisation column, resource names, list text and
   form labels all read clearly against the dark surfaces.
5. Open a modal (e.g. **Resources → Add resource**) and confirm its panel, labels and
   the primary button are legible in dark.
6. Click **Light** — the UI returns to the light theme. Then click **Match system**: the
   theme now follows the OS appearance and flips live if you change the OS setting.
7. (Reduced motion) Enable _Emulate prefers-reduced-motion: reduce_ (or the OS setting)
   and confirm entrance animations (modal pop, toast) are suppressed/instant.

## Acceptance criteria

- ✅ On a fresh profile the default theme is **light** (`<html data-theme="light">`); the
  app does **not** auto-switch to dark from the OS setting alone.
- ✅ The icon button directly below **Settings** switches between explicit light and dark choices,
  updates its accessible action name, remains usable on the collapsed icon rail and saves the
  choice in this browser.
- ✅ **Settings → My display → Appearance on this device** offers **Light**, **Dark** and **Match system**; choosing
  one re-themes every surface (sidebar, grid, lists, modals, banner, toast) immediately,
  with no reload.
- ✅ With **Match system** selected, the theme follows the OS appearance (and re-themes
  live when the OS scheme changes).
- ✅ Text on every re-themed surface remains legible (meets WCAG AA contrast).
  (The axe oracle proves this on the grid and a modal — see US-KBD-04.)
- ✅ With `prefers-reduced-motion: reduce`, entrance animations are suppressed/instant.
