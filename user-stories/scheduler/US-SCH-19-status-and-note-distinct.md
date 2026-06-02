# US-SCH-19 — Allocation status and notes are visually distinct on the bar

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "allocation status and note are visually distinct on the bar (US-SCH-19)"

## Goal
Tell confirmed, tentative and completed allocations apart at a glance on the timeline, and flag the bars that carry a note.

## Why
A manager scanning the schedule needs to know which bookings are firm versus pencilled-in (tentative), which work is already done (completed), and which bars carry context worth reading — without opening each one. Crucially, tentative must read as *different*, not *faded*: an earlier version dimmed the whole bar with opacity, which quietly broke the label's contrast. The current design keeps the label fully legible and signals status with a border/hatch and small glyphs instead.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and reset the horizontal scroll. The seeded **Visual Design** bar on Tyler Nix is **tentative**.
1. Look at the **Visual Design** bar: it has a **dashed border** and a faint **diagonal hatch** overlay, while its label text stays at full contrast.
2. Click the **Wireframes** bar to open **Edit allocation**.
3. Set **Status** = *Completed*, type a **Note** (e.g. `Handed off to QA`), click **Save**.
4. The Wireframes bar now shows a **✓** before the task name and a **•** marker (note present).
5. Hover the Wireframes bar — the detail popover shows the note text.

## Acceptance criteria
- ✅ A **tentative** bar carries `data-status="tentative"`, a dashed border and a hatch overlay; its label remains full-contrast (no whole-bar opacity).
- ✅ A **completed** bar carries `data-status="completed"` and shows a **✓** before the task name.
- ✅ A bar with a **note** shows a **•** marker, and the note appears in the hover/focus popover.
- ✅ A plain **confirmed** bar with no note shows none of these (solid border, no ✓, no •) and carries `data-status="confirmed"`.
