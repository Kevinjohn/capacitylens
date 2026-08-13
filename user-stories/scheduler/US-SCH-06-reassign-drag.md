# US-SCH-06 — Reassign an allocation onto another resource

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/features.spec.ts` → "dragging an allocation onto another row reassigns it" and "rejects a vertical reassignment onto a non-working start date"

## Goal

Hand a piece of work to a different person by dragging its bar onto another resource's row; the target row highlights mid-drag and the bar moves there on drop.

## Why

Re-balancing the team is a constant: someone is overbooked, someone else has slack, so the work moves. Dragging the bar from one lane to another is the most direct expression of "give this to them," and the live target highlight confirms which row will receive it before you let go — so a near-miss doesn't drop work on the wrong person.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`). Set **Weeks visible** to **4 weeks** and click **Today** so the seed bars are in view. Scroll the timeline fully to the left.

1. Find the **Brand System** bar (currently on its seeded resource's lane).
2. Press down on the middle of the bar.
3. Drag it down (or up) until the pointer is over **Clark Kent**'s lane (`data-resource-id="r-nike"`).
4. While the pointer is over Clark's lane, that lane highlights as the drop target.
5. Release. The bar now lives in Clark's lane, and the highlight clears.

For the unavailable-date path, start with a one-day Friday allocation and drag it vertically onto a
person who does not work Fridays. The lane does not show the valid drop highlight; releasing leaves
the allocation on its original row and explains that the allocation cannot start on a non-working
day. The same rule combines the company and personal calendars. An allocation whose **Ignore
working days** checkbox is enabled deliberately bypasses both recurring calendars.

## Acceptance criteria

- ✅ During the drag, the target lane carries `data-droptarget` (it is highlighted).
- ✅ After dropping, the **Brand System** bar is inside Clark's lane (`[data-resource-id="r-nike"]`).
- ✅ Once the drop completes, the `data-droptarget` highlight is cleared from the lane.
- ✅ A vertical drop whose unchanged start is personally or company-wide non-working is rejected
  atomically, without changing assignee or dates.
- ✅ **Ignore working days** permits that literal drop; time off remains a visible conflict rather
  than changing the date silently.
- ✅ The bar tracks vertical pointer movement without an animated transform delay.
