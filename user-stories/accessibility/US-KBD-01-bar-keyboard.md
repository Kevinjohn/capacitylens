# US-KBD-01 — Operate an allocation bar by keyboard

**Area:** Keyboard & accessibility · **Persona:** Keyboard-only scheduler · **Linked E2E:** `e2e/accessibility.spec.ts` → "an allocation bar is focusable and moves/resizes with the keyboard"

## Goal
Move and resize an allocation bar entirely from the keyboard — no mouse drag required —
and hear what the bar is when it's focused.

## Why
Drag-and-drop is mouse-first. A keyboard-only or screen-reader user still needs to
schedule and adjust work. Each bar is a focusable control with arrow-key equivalents
of the drag gestures, and its accessible name announces the task, hours, status and
dates plus the available shortcuts — so the timeline is fully operable without pointing.

## How (end-to-end)
**Precondition:** Seeded app open at Schedule (`/`). Click **4w** and scroll the grid
left if needed so the seed bars are visible (running near the seed dates; otherwise
**Jump to date → 2026-06-01**). Use the **Wireframes** bar (4 days) — its right edge
stays on screen.
1. Press **Tab** repeatedly until the **Wireframes** allocation bar is focused
   (it shows a visible focus ring).
2. With the bar focused, read its accessible name (screen reader, or DevTools
   accessibility pane): it announces task, `Nh per day`, status, and `start to end`
   dates, ending with "Enter to edit; arrow keys to move, Shift+arrow to resize."
3. Press **Enter** — the allocation editor (Edit allocation modal) opens. Press
   **Escape** to close it and return focus to the bar.
4. Press **→** — the bar moves one day later. Press **←** — it moves one day earlier
   (back to where it was).
5. Press **Shift+→** — the bar's end extends one day (it gets wider). Press **Shift+←**
   — the end contracts one day.

## Acceptance criteria
- ✅ The bar is reachable with **Tab** and shows a visible focus indicator.
- ✅ **Enter** (or **Space**) opens the allocation editor for that bar.
- ✅ **→ / ←** move the bar one day later / earlier.
- ✅ **Shift+→ / Shift+←** resize the bar's end out / in by one day.
- ✅ The bar's `aria-label` announces task, hours/day, status and start→end dates, and
  names the shortcuts ("Enter to edit; arrow keys to move, Shift+arrow to resize.").
- ✅ A keyboard resize that would invert the range (end before start) is ignored — the
  bar stays put rather than producing an invalid allocation.
