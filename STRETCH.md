# Floaty — Stretch goal

**Goal:** Floaty is polished, accessible, feature-rich and durable, with a cohesive
modern-CSS design system and comprehensive automated test coverage plus an
adversarial review pass. The entire gate is green with no open findings:

- `tsc -b` clean
- `eslint .` clean
- `vitest run --coverage` green, **≥90% on `src/lib` + `src/store`**, healthy elsewhere
- `vite build` succeeds
- `playwright test` all green
- Multi-agent adversarial review (bugs / a11y / types / UX) — no unresolved real findings

## Backlog

### Modern CSS / design system
- Design tokens via Tailwind v4 `@theme` + CSS custom properties (palette, spacing, radii, shadows, typography).
- Dark mode via `prefers-color-scheme`; `prefers-reduced-motion` respected.
- `focus-visible` rings, transitions, `color-mix()` tints, logical properties, a container query.
- Polish every surface: nav, buttons, modal, fields, lists, scheduler (bars, handles, markers, header, avatars).

### Features
- Time off rendered as labelled blocks on the timeline (not just greyed days).
- Resource avatars (initials), Temp tag and utilisation in the left column.
- Schedule filters: discipline / client / project + text search; toggle tentative.
- Scroll-to-today on load + a "today" vertical line.
- Change assignee in the edit modal (move allocation between resources, honouring placeholder binding); Duplicate allocation.
- Overall + per-discipline utilisation summary.
- Empty states / onboarding hint.

### Durability
- Undo / redo (store history) with ⌘Z / ⌘⇧Z and toolbar buttons.
- Error boundary around the app; storage-quota-safe persistence; clear import-validation messaging.
- A real schema migration (v1 → v2) with a test proving the versioned seam.

### Testing
- Coverage tooling + thresholds.
- Component tests for all lists/forms, `useDragResize`, `ResourceLane` draw, `AllocationBar` preview, `ImportExport`, error boundary, undo/redo.
- Expanded E2E: full CRUD per entity, time-off block + greying, placeholder rejection via UI, assignee change, undo/redo, filters.

### Review
- Adversarial multi-agent review → fix all real findings → re-run gate.
