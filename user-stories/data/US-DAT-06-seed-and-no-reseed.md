# US-DAT-06 — Demo resets to its canonical seed

**Area:** Demo · **Persona:** Evaluator · **Linked E2E:** `e2e/data.spec.ts`, `e2e/crud.spec.ts`

## Goal

Explore and edit freely without creating durable browser-owned scheduling data.

## Why

The demo should be safe to experiment with and deterministic for evaluation. Scheduling edits last
for the current page only, while real deployments remain empty unless an operator explicitly seeds
them.

## How (end-to-end)

**Precondition:** Open the in-memory demo and select **Studio North**.

1. Confirm a canonical seeded row such as **Tyler Nix** is present.
2. Make a visible change during the current page session and confirm it remains while navigating.
3. Reload the page, pass through the entry gates, and select **Studio North** again.
4. Confirm the canonical seed has replaced the temporary edit.

## Acceptance criteria

- ✅ Every new demo page load starts with the canonical fictional seed.
- ✅ Changes remain available during that page session.
- ✅ A full reload discards demo changes and restores the seed.
- ✅ A real server starts empty unless the operator explicitly enables demo seeding.
