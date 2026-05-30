# US-RES-09 — Choose a resource's colour

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "accepts a valid hex colour and rejects an invalid one"

## Goal
Set a resource's colour — via the colour picker or by typing a 6-digit hex — so their
avatar and bars are easy to pick out on the schedule.

## Why
Colour is how a manager visually tracks a person across a busy timeline. Letting them set a
deliberate colour (and rejecting malformed values) keeps the schedule readable and avoids
broken styling.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. On the **Tyler Nix** row, click **Edit**.
2. In **Colour**, use the **Colour picker** swatch, or type into **Colour hex value** a
   valid hex such as `#22c55e`.
3. Click **Save**. The dialog closes.
4. Edit **Tyler Nix** again and type an invalid value such as `nope` into
   **Colour hex value**, then click **Save**.

## Acceptance criteria
- ✅ A valid 6-digit hex (`#rrggbb`, e.g. `#22c55e`) is accepted; after Save the resource's
  avatar uses the chosen colour (the displayed shade may be nudged for legibility).
- ✅ An invalid value (e.g. `nope`, or a 3-digit hex) keeps the dialog open and is rejected
  with the inline error "Enter a valid 6-digit hex colour, e.g. #3b82f6." and
  `aria-invalid` on the **Colour hex value** field.
