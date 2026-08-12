# US-ALL-09 — Create repeating weekly or monthly allocations

**Area:** Allocation modal · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "creates and undoes a weekly repeat batch", "edits one monthly occurrence, deletes its series tail and restores the tail with one Undo", and repeat preview tests

## Goal

Create several linked allocations from one completed New allocation form, using a weekly or monthly
cadence through an explicit end date.

## Why

Regular meetings and recurring project work should not require the same allocation to be entered
again and again. The manager still needs ordinary bars afterwards, so each occurrence remains free
to edit independently and can still be deleted without affecting its siblings when that is the
intended scope.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`).

1. Click a resource row’s **+** button, or draw a new range on an empty part of their lane.
2. Choose the **Project** and **Activity**, then enter the dates and workload as usual.
3. Open **Repeat**. It defaults to **Doesn’t repeat** and also offers **Weekly**, **Every 2 weeks**,
   **Every 3 weeks**, **Every 4 weeks** and **Monthly**.
4. Choose a repeating option, then choose the required **Repeat until** date. It cannot be before
   today or the allocation start, must include at least one repeated occurrence, and can be no more
   than six calendar months after the allocation start.
5. Review the preview: it shows the inclusive cutoff, how many linked allocations will be created,
   and the final occurrence start. An occurrence that starts on the cutoff is included, even when
   its multi-day span ends later.
6. Review any aggregate capacity or time-off warning. It is advisory, so **Save** remains available.
7. Click **Save**. The modal closes and the generated allocations appear as ordinary schedule bars.
8. Use Undo once. Every allocation created by that Save is removed together.

## Acceptance criteria

- ✅ Repeat appears only in **New allocation**, including row-button and drawn-range creation.
- ✅ **Doesn’t repeat** creates one allocation through the existing path.
- ✅ Choosing a cadence reveals a blank, required **Repeat until** date; one-off creation does not.
- ✅ The cutoff cannot precede today or the allocation start, must permit at least one repeat, and
  cannot exceed six calendar months after the allocation start.
- ✅ Occurrences whose start is on the inclusive cutoff are included; their end may fall after it.
- ✅ The preview shows the cutoff and final start using the app's short weekday/day/month date style.
- ✅ Saving a repeat is all-or-nothing and produces one undo step.
- ✅ Generated bars remain independently editable while retaining their hidden series membership.
- ✅ Delete can remove one occurrence or the selected and future occurrences; earlier starts remain.
- ✅ Either deletion choice is one undoable operation, and legacy repeat batches remain unlinked.
- ✅ Edit shows no Repeat control, and linked occurrences do not offer Duplicate.
- ✅ Duplicate remains available for unlinked allocations and creates exactly one independent allocation.
- ✅ Capacity and time-off warnings count affected generated allocations and never block Save.
