# US-SCH-05 — Resize an allocation with its grip handles

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "resizes a bar via its end handle"

## Goal
Lengthen or shorten an allocation by dragging the grip handle at its start or end edge; the bar can never shrink below one day.

## Why
Estimates change once work is underway — a two-day activity becomes four. Dragging the end grip to extend (or the start grip to pull the beginning in) is the direct way to re-scope without opening a form. The one-day floor stops a careless drag from collapsing an allocation into nothing.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Set zoom to **4w** and **Jump to date** → `2026-06-01`.
1. Find the **Wireframes** bar (a 4-day allocation whose right edge stays on-screen).
2. Note its current width.
3. Hover its right edge to reveal the **end** grip handle (`data-testid="resize-end"`).
4. Press down on the end handle, drag right by roughly one day-column, and release. The bar extends by one whole day.
5. Now drag the same end handle left, hard, past the bar's start. The bar stops at a minimum of one day — it does not collapse or invert.

## Acceptance criteria
- ✅ Dragging the **end** handle right extends the bar by whole days (its width is measurably greater than before).
- ✅ Dragging the **start** handle works symmetrically (pulling the start edge moves the start date, not the end).
- ✅ An allocation cannot shrink below **1 day**: dragging an edge past the opposite edge clamps at a single day rather than producing a zero/negative range.
