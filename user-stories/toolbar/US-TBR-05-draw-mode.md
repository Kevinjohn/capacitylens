# US-TBR-05 — Switch Work / Time-off draw mode

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "switches draw mode between Work and Time off" · `e2e/features.spec.ts` → "drawing in Time off mode opens a prefilled time-off form"

## Goal
Toggle what a lane draw creates: an allocation (Work) or a time-off block (Time off).

## Why
The same drag-on-a-lane gesture is the fastest way to block out either work or absence. A single mode toggle lets the manager reuse the gesture for both without separate tools, and the active mode is clearly pressed.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. The draw-mode toggle is a pair of buttons **Work** / **Time off** (distinct from the **Time off** nav link in the sidebar).
1. With **Work** active, draw a left-to-right gesture on the **Nike Spiros** lane.
2. Cancel that dialog. Click the **Time off** toggle button so it becomes active.
3. Draw a left-to-right gesture on the **Nike Spiros** lane again.

## Acceptance criteria
- ✅ The active draw-mode button has `aria-pressed="true"` and the other `aria-pressed="false"`.
- ✅ In **Work** mode, a lane draw opens the **New allocation** dialog, preset to that lane's resource.
- ✅ In **Time off** mode, a lane draw opens the **Add time off** dialog, with **Resource** preset to that lane's resource.
- ✅ Switching the toggle changes only what the next draw creates; it does not alter existing bars.
