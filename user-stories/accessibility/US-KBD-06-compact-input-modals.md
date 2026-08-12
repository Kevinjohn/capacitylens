# US-KBD-06 — Scan compact input modals

**Area:** Accessibility · forms · **Persona:** Studio manager · **Linked E2E:**
`e2e/modal-layout.spec.ts`

## Goal

Scan labels, required markers and controls consistently across the common management forms without
making narrow screens harder to use.

## Why

Stacking every label above its control makes short add/edit dialogs taller and slower to scan. The
approved Resource form establishes a compact row while retaining a mobile-first stacked fallback.
The same visual language should apply to the other common input dialogs.

## How (end-to-end)

1. Open each add or edit dialog for **External party**, **Discipline**, **Client**, **Project**,
   **Activity** and **Time off**.
2. At a normal desktop width, compare the label and control columns.
3. In Client or Project, enable **Use a code name** and inspect the conditional **Code name** field.
4. In Activity, switch Kind and inspect the conditional **Project** field.
5. Narrow the browser below the small-screen breakpoint.
6. Submit one required form without its required value and inspect the error association.

## Acceptance criteria

- ✅ At normal modal widths, every visible field in the six named dialogs uses the same approximate
  25% label / 75% control row as the Resource form.
- ✅ Conditional Activity and privacy controls retain that row when they appear.
- ✅ Below the small-screen breakpoint, each label stacks above its full-width control.
- ✅ Long labels wrap within the label area without shifting the control column or widening the page.
- ✅ Required markers, invalid styling and `aria-describedby` error association remain intact.
- ✅ Allocation, company, invitation, Team and other administrative dialogs are unchanged.

## Automated coverage

`e2e/modal-layout.spec.ts` verifies all six create dialogs plus normal geometry, long-label wrapping,
narrow stacking, page containment and required-error association. Shared field and form component
tests verify the opt-in layout contract, including conditional fields.
