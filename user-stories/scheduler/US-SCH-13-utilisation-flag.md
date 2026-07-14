# US-SCH-13 — Per-resource near-term load flag

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "shows seeded resources, grouping and capacity cues"

## Goal
Each resource's left-column **Utilisation** figure (heading "Utilisation · Nw", where N tracks the active week-range toggle) turns **red** when that person is over-allocated anywhere in a **fixed 14-day forward window from today** — a near-term radar that is independent of the zoom/scroll the % itself tracks.

## Why
The timeline shows *where* work sits; the left-column figure answers "is this person busy, and about to be slammed?" in one place. Two **separate** signals share that spot: the **Utilisation %** tracks the currently visible window (it recomputes when you change the week-range toggle), while the **red over-soon flag** is a fixed **14-day forward window from today** — a stable near-term radar, independent of where the manager has scrolled or zoomed. Turning the figure red on a near-term over-allocation makes the at-risk people jump out of the left column without reading every bar.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`).
1. In the left column, each resource row shows a **utilisation** figure under the heading **"Utilisation · Nw"** (N = the active week-range toggle), expressed as a **%**.
2. Identify a resource over-allocated within the **next 14 days from today**: their figure is rendered **red / emphasised** rather than the normal muted style.
3. Confirm a resource who is comfortably within capacity in that window shows their % in the normal (non-red) style.
4. Scroll/jump the timeline elsewhere and confirm the **red flag** stays put — it tracks the fixed 14-day forward window, not the viewport (the % itself recomputes for the visible window).

## Acceptance criteria
- ✅ Each resource row shows a **utilization** figure (`data-testid="utilization"`) as a percentage under **"Utilisation · Nw"** (N = the active week-range toggle).
- ✅ A resource over-allocated within the **fixed 14-day forward window** shows their figure in **red / emphasised** styling.
- ✅ A resource within capacity in that window shows the normal (non-red) styling.
- ✅ Scrolling or jumping the timeline does **not** move the **red flag** — it tracks the fixed 14-day forward window, not the visible range (the % itself recomputes for the visible window).
