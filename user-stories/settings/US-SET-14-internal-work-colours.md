# US-SET-14 — Internal work colours

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:** `e2e/internal-colours.spec.ts`

## Goal

Keep internal activities and Internal-owned projects neutral grey by default, with an explicit
company setting that can restore their saved palette colours.

## Why

Internal work should read as background agency work rather than compete visually with client work.
Some teams still use colour to distinguish internal projects, so the palette choice remains
available without making every team configure it.

## How (end-to-end)

1. Open **Settings**. Under **Internal work colours**, confirm **Grey** is selected.
2. Open **Projects**, add `Quarterly planning`, and choose **Internal** as its Client.
3. Confirm the existing **Colour** picker disappears and save the project.
4. Confirm the project swatch is grey.
5. Return to **Settings** and choose **Use colour palette**.
6. Return to **Projects**. Confirm the project's saved palette colour is restored and its edit form
   shows the **Colour** picker again.

## Acceptance criteria

- ✅ The per-account `internalColourMode` setting offers only `grey` and `palette`; absent defaults
  to `grey`, and the value syncs, persists and exports.
- ✅ Grey mode renders `internal` activity bars and Internal-owned project bars/swatches neutral
  grey. Cross-project activities remain distinct and keep their existing colours.
- ✅ The project form hides the picker only while its selected client is Internal and the setting is
  Grey. The project colour remains stored and valid.
- ✅ Palette mode reveals the same picker and restores the saved project colour immediately.
- ✅ Viewers can see the selected setting but cannot change it.
