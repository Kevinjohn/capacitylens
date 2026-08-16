# US-TOF-06 — Record a company-wide closure for Everyone

**Area:** Time off · **Persona:** Studio manager · **Linked E2E:** `e2e/company-timeoff.spec.ts` → company-wide closure journey

## Goal

Record one time-off entry that applies to the whole company — a bank holiday or a
whole-agency shutdown — so every tracked person and placeholder reads as unavailable on
those dates without creating an entry per person.

## Why

A closure belongs to the company, not to a list of people: fan-out rows would miss new
hires and take N deletes to undo. One **Everyone** record covers everyone at read time,
and work already planned across the shutdown lights up red instead of silently
disappearing — that warning is the point of the feature.

## How (end-to-end)

**Precondition:** Seeded app open; click **Time off** in the sidebar (`/timeoff`).

1. Click **Add time off**. The "Add time off" dialog opens.
2. Choose **Resource** = _Everyone_ (the first option; never preselected).
3. Observe **Type** now offers only _Holiday_ and _Other_.
4. Set **Start**/**End** to a range overlapping an existing seeded allocation.
5. Click **Save**. The dialog closes; an **Everyone** group appears FIRST in the list,
   its row prefixed with the type label.
6. Go to **Schedule** (`/`), click **Today**: every tracked row shows the hatched block
   over the closure dates; the seeded allocation's covered days flag over-capacity red;
   utilisation figures change.

## Acceptance criteria

- ✅ **Everyone** is the first picker option and is never the default for a new entry.
- ✅ With Everyone selected, Type offers only Holiday and Other; selecting a person
  restores all four types.
- ✅ The saved entry persists `resourceId: null`; reload keeps the closure and its
  schedule effects.
- ✅ Every capacity-tracked row (people and placeholders) shows the hatch and zero
  availability on covered dates; allocation dates and hours are untouched, so overlapped
  work flags the existing red conflict treatment.
- ✅ External rows draw no hatch and count nothing, but a NEW placement cannot start on a
  closure date for anyone — externals included.
- ✅ A closure day that is also a recurring non-working day stays grey with the marker
  and no red; **Ignore working days** never bypasses a closure.
- ✅ Editing the entry back to a single person removes the other rows' hatches; deleting
  it restores capacity everywhere.
- ✅ Editors can create/edit/delete Everyone entries; Viewers see them read-only.
