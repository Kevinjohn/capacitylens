# US-KBD-04 — No serious/critical WCAG violations (axe)

**Area:** Keyboard & accessibility · **Persona:** Accessibility reviewer · **Linked E2E:** `e2e/a11y.spec.ts` → "scheduler has no serious or critical accessibility violations", "scheduler in dark mode has no serious or critical violations", "a resource form modal has no serious or critical violations"

## Goal
Verify the scheduler (light **and** dark) and a form modal carry zero serious or
critical WCAG 2.1 AA violations, by an automated oracle rather than by eye.

## Why
`getByRole` only proves an attribute exists — it can't prove the structure is valid or
that text meets contrast. axe is the a11y oracle here: it audits the rendered DOM
against WCAG 2.1 A/AA and is what guards the whole accessibility pass against silent
regressions. Holding the bar at "no serious/critical" keeps CapacityLens usable for everyone.

## How (end-to-end)
**Precondition:** Seeded app open. Entrance animations are disabled (reduced motion)
so axe samples settled colours — a mid-fade reads as false low-contrast. This is
chiefly the linked automated suite; to run it manually use a browser axe extension on
each target.
1. On **Schedule** (`/`, light scheme), run an axe scan scoped to WCAG 2.1 A/AA once the
   grid (`scheduler-grid`) is visible. Confirm no serious/critical violations.
2. Switch the scheme to **dark** (OS setting or DevTools *Emulate prefers-color-scheme:
   dark*), reload **Schedule**, and run the scan again — still no serious/critical
   violations.
3. Go to **Resources → Add resource**; once the dialog is visible and its entrance
   animation has settled, run the scan on the modal — no serious/critical violations.

## Acceptance criteria
- ✅ The **Schedule** grid in **light** scheme has zero serious or critical WCAG 2.1 AA
  violations.
- ✅ The **Schedule** grid in **dark** scheme has zero serious or critical violations.
- ✅ The **Add resource** form modal has zero serious or critical violations.
- ✅ The scans cover the WCAG 2.1 A/AA tag set (`wcag2a`, `wcag2aa`, `wcag21a`,
  `wcag21aa`) and are sampled with animations settled (reduced motion).
