# US-TOF-06 — Record a named company closure

**Area:** Time off · **Persona:** Studio manager · **Linked E2E:** `e2e/company-closures.auth.spec.ts` → "an editor creates, sees, edits and deletes a literal company closure band"

**Documentation:** [Time off and company closures](../../docs-src/using/time-off.md)

## Goal

Record a named company closure for a bank holiday or whole-agency shutdown, so every person and
placeholder reads as unavailable on those dates without creating a time-off entry per person.

## Why

A closure belongs to the company, not to a list of people. One company-closure record covers current
and future people and placeholders; work already planned across the closure remains visible and shows
the usual capacity conflict.

## How (end-to-end)

**Precondition:** Seeded app open; click **Time off** in the sidebar (`/timeoff`).

1. Under **Company closures**, choose **Add closure**. The company-closure form opens.
2. Enter a name and set the inclusive **Start** and **End** dates to overlap a seeded allocation.
3. Save. The named closure appears in the company-closures list.
4. Open **Schedule** (`/`) and click **Today**. The named closure band spans the tracked-resource
   grid; the seeded allocation remains visible and its covered days show the usual capacity conflict.

## Acceptance criteria

- ✅ A named company closure is a separate company entity, not a personal time-off entry or an
  **Everyone** resource selection.
- ✅ The inclusive date span is literal: it is not filtered by working days and has no per-person
  exception.
- ✅ The saved closure persists across reload and applies to people and placeholders, including
  people added after it is created.
- ✅ The schedule renders one named band across the tracked-resource grid. People and placeholders
  have zero availability on covered working days; allocation dates and hours are untouched, so
  overlapped work shows the existing capacity conflict.
- ✅ External rows draw no closure band and count nothing, but a new placement cannot start on a
  closure date for anyone, including externals.
- ✅ A closure on a recurring non-working day stays grey with its marker and no red; **Ignore working
  days** never bypasses a closure.
- ✅ Editing or deleting a closure updates its schedule effects; deleting it restores capacity
  everywhere.
- ✅ Editors can create, edit and delete company closures; Viewers see them read-only.
