# US-SET-14 — Internal work colours

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:** `e2e/internal-colours.spec.ts`

**Documentation:** [Projects and allocations](../../docs-src/guide/projects-and-allocations.md)

## Goal

Keep internal activities and Internal-owned projects neutral grey, so internal work never competes
visually with client work.

## Why

Internal work should read as background agency work rather than compete visually with client work.
A fixed rule is simpler than a company setting nobody needs to configure.

## How (end-to-end)

1. Open **Settings** and confirm there is no colour option for internal work.
2. Open **Projects**, add `Quarterly planning`, and choose **Internal** as its Client.
3. Confirm the existing **Colour** picker disappears and save the project.
4. Confirm the project swatch is grey and its edit form shows no **Colour** picker.

## Acceptance criteria

- ✅ `internal` activity bars and Internal-owned project bars/swatches are always neutral grey.
  Unattributed All-projects activities remain distinct and keep their existing colours; attributed
  ones use their effective project's colour.
- ✅ The project form hides the picker while its selected client is Internal. Any stored project
  colour remains valid and is not cleared.
- ✅ Internal projects and activities are always shown and searchable; Settings has no switch to
  hide them.
