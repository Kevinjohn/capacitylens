# US-SCH-07 — Reassigning onto a mismatched placeholder is rejected

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `src/components/scheduler/AllocationBar.interaction.test.tsx` → "leaves assignee, dates and hours unchanged when a diagonal reassign is rejected"

## Goal

When you drag an allocation onto a placeholder that is bound to a _different_ project, the move is refused: the bar stays on its original resource and a toast explains why.

## Why

Placeholders stand in for a yet-to-be-hired role on **one specific project**, so they may only ever hold activities from that project. Silently snapping the bar back would leave the manager guessing why a drop "didn't take." Refusing the reassignment _and saying so_ keeps the placeholder's project binding trustworthy while making the rule legible the moment it bites. (Related: the create path is locked the same way — see `e2e/features.spec.ts` → "drawing on a placeholder locks the modal to its bound project".)

## How (end-to-end)

**Precondition:** Seeded app open. In **Settings**, enable **Show placeholders**, then return to
**Schedule** (`/`). Set **Weeks visible** to **4 weeks** and click **Today** so the seed bars are in
view. Scroll the timeline fully to the left. The **Senior Designer** placeholder (`data-resource-id="r-ph-designer"`) is bound to
**Project Lightning**; the **Brand System** bar belongs to an activity on **Brand Themes**.

1. Find the **Brand System** bar and note its current resource (its lane) and dates.
2. Press down on the bar and drag it onto the **Senior Designer** placeholder lane (`data-resource-id="r-ph-designer"`).
3. Release. Because Brand System's activity is from Brand Themes — not the placeholder's bound Project Lightning — the reassignment is rejected.
4. Observe: the bar is **not** in the placeholder's lane; it remains on its original resource. A toast appears explaining the placeholder rule.

## Acceptance criteria

- ✅ After the invalid drop, the allocation's **resourceId is unchanged** — the bar is still on its original resource, not the placeholder.
- ✅ A toast appears mentioning the placeholder rule ("A placeholder can only be assigned to activities from its bound project.").
- ✅ The rejected diagonal drag is atomic: the allocation's **assignee, dates and hours are all unchanged**.
