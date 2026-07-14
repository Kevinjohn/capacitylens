# US-NAV-15 — Blue identity, green positive actions, red destructive actions

**Area:** Navigation & shell · **Persona:** Any CapacityLens user · **Linked automated coverage:** `e2e/navigation.spec.ts` (rendered identity/action roles), `src/components/common/ui.test.tsx` (button role classes), `src/lib/color.test.ts` (token contrast), `e2e/a11y.spec.ts` (light/dark rendered accessibility)

## Goal

Recognise what CapacityLens is, what moves work forward, and what is destructive at a glance —
without the interface falling back to an indistinct purple accent or sacrificing contrast.

## Why

Colour should carry a small, consistent amount of meaning. Blue is the product identity and
navigation accent. Green is reserved for positive actions such as Create, Save, Add and Continue.
Destructive actions remain red, using the accessible soft-red pairing where a solid red would fail
contrast. The same roles must hold in light and dark themes, while user-selected client, project
and discipline swatches remain data colours rather than being confused with the action language.

## How (end-to-end)

1. Open a seeded company in the default light theme and note the CapacityLens wordmark and active
   navigation accent.
2. Open a form such as **Clients → Add client**. Confirm the primary **Save** action is green.
3. Open a destructive confirmation or Settings → **Clear device data**. Confirm its action is red,
   and its label states the destructive operation explicitly.
4. Switch to **Dark** in Settings and repeat the visual check. Confirm the identity, positive and
   destructive roles remain distinct and legible.
5. Pick a user-defined client/project/discipline swatch. Confirm it changes that entity's data
   colour only; it does not change the meaning of primary or destructive controls.

## Acceptance criteria

- ✅ Product identity, wordmark and navigation accents use the semantic blue brand tokens; the
  default UI is not purple-led.
- ✅ Primary positive controls (Create, Save, Add, Continue and equivalent submit/recovery actions)
  use the semantic green action token and readable action ink.
- ✅ Destructive controls use the semantic red danger role and keep explicit labels; the danger
  pairing remains contrast-safe in both themes.
- ✅ Light and dark theme token pairings meet WCAG AA for the rendered text; the role distinction
  does not depend on colour alone because controls retain meaningful labels.
- ✅ Default account/resource/entity presets use the refreshed blue family, while user-selected
  preset swatches continue to render as entity data colours.
