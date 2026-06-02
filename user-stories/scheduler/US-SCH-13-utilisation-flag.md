# US-SCH-13 — Per-resource near-term load flag

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "shows seeded resources, grouping and capacity cues"

## Goal
Each resource shows a near-term load percentage — a fixed 14-day forward window from today, labelled "Utilisation · next 2w" — that turns red when that person is over-allocated anywhere in that window.

## Why
The timeline shows *where* work sits; the load figure answers "is this person about to be slammed?" in one number. The load % is **not** the visible range — it's always the next **14 days from today** — so pinning it to that fixed forward window (independent of where the manager has scrolled) keeps it a stable radar for the immediate future: scrolling or jumping the timeline does not change a resource's figure, only their actual bookings in that window do. Turning it red on over-allocation makes the at-risk people jump out of the left column without reading every bar.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`).
1. In the left column, each resource row shows a **utilisation** figure under the heading **"Utilisation · next 2w"**, expressed as a **%**.
2. Identify a resource over-allocated within the next two weeks: their figure is rendered **red / emphasised** rather than the normal muted style.
3. Confirm a resource who is comfortably within capacity in that window shows their % in the normal (non-red) style.
4. Scroll/jump the timeline elsewhere and confirm the load figure does **not** change — it tracks the fixed forward window, not the viewport.

## Acceptance criteria
- ✅ Each resource row shows a **utilization** figure (`data-testid="utilization"`) as a percentage under **"Utilisation · next 2w"**.
- ✅ A resource over-allocated within the 14-day forward window shows their figure in **red / emphasised** styling.
- ✅ A resource within capacity in that window shows the normal (non-red) styling.
- ✅ Scrolling or jumping the timeline does **not** change the figure (it's the fixed forward window, not the visible range).
