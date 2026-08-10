# US-ALL-09 — Create repeating weekly or monthly allocations

**Area:** Allocation modal · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "creates and undoes a weekly repeat batch" and repeat preview tests

## Goal

Create several independent allocations from one completed New allocation form, using a weekly or
monthly cadence over the next three calendar months.

## Why

Regular meetings and recurring project work should not require the same allocation to be entered
again and again. The manager still needs ordinary bars afterwards, so each occurrence remains free
to edit or delete without changing the others.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`).

1. Click a resource row’s **+** button, or draw a new range on an empty part of their lane.
2. Choose the **Project** and **Activity**, then enter the dates and workload as usual.
3. Open **Repeat**. It defaults to **Doesn’t repeat** and also offers **Weekly**, **Every 2 weeks**,
   **Every 3 weeks**, **Every 4 weeks** and **Monthly**.
4. Choose a repeating option. The form previews how many independent allocations it will create and
   the final start date.
5. Review any aggregate capacity or time-off warning. It is advisory, so **Save** remains available.
6. Click **Save**. The modal closes and the generated allocations appear as ordinary schedule bars.
7. Use Undo once. Every allocation created by that Save is removed together.

## Acceptance criteria

- ✅ Repeat appears only in **New allocation**, including row-button and drawn-range creation.
- ✅ **Doesn’t repeat** creates one allocation through the existing path.
- ✅ Every repeating choice covers a fixed three-calendar-month window and includes the entered start.
- ✅ The preview uses the same short weekday/day/month date style as the rest of the app.
- ✅ Saving a repeat is all-or-nothing and produces one undo step.
- ✅ Generated bars are independent after creation; editing or deleting one does not change another.
- ✅ Edit and Duplicate show no Repeat control, and Duplicate creates exactly one allocation.
- ✅ Capacity and time-off warnings count affected generated allocations and never block Save.
