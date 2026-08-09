# US-TBR-05 — Switch Work / Time-off draw mode

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "switches draw mode between Work and Time off" · `e2e/features.spec.ts` → "drawing in Time off mode opens a prefilled time-off form"

## Goal

Toggle what a lane draw creates: an allocation (Work) or a time-off block (Time off).

## Why

The same drag-on-a-lane gesture is the fastest way to block out either work or absence. A single-selection radiogroup lets the manager reuse the gesture for both without separate tools, and the active mode is clearly checked. **Time off mode also makes itself unmistakable across the whole grid — existing work bars recede to inert, dimmed neutral ghosts and booked time off glows amber — so the toggle never reads as a dead control (its only previous feedback was its own checked state, which several testers missed).**

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`); set **Weeks visible** to **4 weeks** and click **Today** so the seed bars are in view. The draw-mode toggle is a pair of buttons **Work** / **Time off** (distinct from the **Time off** nav link in the sidebar).

1. With **Work** active, draw a left-to-right gesture on the **Nike Spiros** lane.
2. Cancel that dialog. Click the **Time off** toggle button so it becomes active.
3. Draw a left-to-right gesture on the **Nike Spiros** lane again.

## Acceptance criteria

- ✅ The draw-mode choices form a radiogroup; the active radio has `aria-checked="true"` and the other has `aria-checked="false"`.
- ✅ In **Work** mode, a lane draw opens the **New allocation** dialog, preset to that lane's resource.
- ✅ In **Time off** mode, a lane draw opens the **Add time off** dialog, with **Resource** preset to that lane's resource.
- ✅ Switching to **Time off** recedes existing work bars to a flat neutral (theme-aware `var(--color-muted)`) at ~20% opacity and makes them **inert** (no click/drag, no hover popover, not tab-focusable); existing time-off blocks glow amber. Switching back to **Work** restores them. The effect is purely visual + interaction state — **no underlying allocation/time-off data changes**.
- ✅ Because the dimmed bars are inert, a draw started _over_ an existing allocation still books time off — the bar no longer intercepts the gesture.
