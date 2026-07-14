# US-SCH-03 — Draw time off directly on a lane

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/features.spec.ts` → "drawing in Time off mode opens a prefilled time-off form"

## Goal
Book time off by drawing on a resource's lane while the toolbar is in **Time off** draw mode; a prefilled "Add time off" form opens with that row's resource already selected.

## Why
Holidays, sick days and other absences are part of capacity, and the manager wants to book them in the same place they plan work — on the timeline. The toolbar's **Work** / **Time off** toggle changes what a draw produces: in **Work** mode a draw opens the "New allocation" modal (see US-SCH-02); in **Time off** mode the very same draw opens the "Add time off" form. (This **Time off** *toggle button* is distinct from the **Time off** *nav link* in the sidebar.) Prefilling the resource removes the one bit of context (whose lane was this?) that a blank form would lose.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Set zoom to **4w** and **Jump to date** → `2026-06-01`. Scroll the timeline fully to the left.
1. In the toolbar, click the **Time off** draw-mode toggle (the button, not the sidebar link).
2. On a resource's lane — e.g. **Nike Spiros** (`data-resource-id="r-nike"`) — press down near the left of the lane, drag right a short distance, and release.
3. An **"Add time off"** form opens with that row's **Resource** preselected (Nike Spiros).
4. Click **Save**; the form closes.

## Acceptance criteria
- ✅ With the toggle on **Time off**, drawing on a lane opens the **"Add time off"** dialog (not "New allocation").
- ✅ The form's **Resource** field is preselected to the row you drew on (`r-nike`).
- ✅ Saving closes the form. (In **Work** mode the same gesture would open "New allocation" instead — see US-SCH-02.)
- ✅ While Time off mode is active the lane's work bars are dimmed (theme-aware neutral) + **inert**, so a draw started *over* an existing allocation still books time off (the bar doesn't grab the gesture). See US-TBR-05 for the full mode treatment.
