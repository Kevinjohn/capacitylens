# US-SCH-06 — Reassign an allocation onto another resource

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/features.spec.ts` → "dragging an allocation onto another row reassigns it"

## Goal
Hand a piece of work to a different person by dragging its bar onto another resource's row; the target row highlights mid-drag and the bar moves there on drop.

## Why
Re-balancing the team is a constant: someone is overbooked, someone else has slack, so the work moves. Dragging the bar from one lane to another is the most direct expression of "give this to them," and the live target highlight confirms which row will receive it before you let go — so a near-miss doesn't drop work on the wrong person.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Set zoom to **4w** and **Jump to date** → `2026-06-01`. Scroll the timeline fully to the left.
1. Find the **Brand System** bar (currently on its seeded resource's lane).
2. Press down on the middle of the bar.
3. Drag it down (or up) until the pointer is over **Nike Spiros**'s lane (`data-resource-id="r-nike"`).
4. While the pointer is over Nike's lane, that lane highlights as the drop target.
5. Release. The bar now lives in Nike's lane, and the highlight clears.

## Acceptance criteria
- ✅ During the drag, the target lane carries `data-droptarget` (it is highlighted).
- ✅ After dropping, the **Brand System** bar is inside Nike's lane (`[data-resource-id="r-nike"]`).
- ✅ Once the drop completes, the `data-droptarget` highlight is cleared from the lane.
