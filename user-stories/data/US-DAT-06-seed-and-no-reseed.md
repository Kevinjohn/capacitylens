# US-DAT-06 — Demo resets to its canonical seed

**Area:** Demo · **Persona:** Evaluator · **Linked E2E:** `e2e/data.spec.ts`, `e2e/crud.spec.ts`

## Goal

Explore and edit freely without creating durable browser-owned scheduling data.

## Acceptance

- Every new demo page load starts with the canonical fictional seed.
- Changes remain available during that page session.
- A full reload discards demo changes and restores the seed.
- A real server starts empty unless the operator explicitly enables demo seeding.
