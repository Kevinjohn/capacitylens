# US-KBD-02 — Modal focus management

**Area:** Keyboard & accessibility · **Persona:** Keyboard-only scheduler · **Linked E2E:** `e2e/accessibility.spec.ts` → "a modal traps Tab, focuses the first control, closes on Escape and restores focus"

## Goal
When any modal opens, keyboard focus moves into it and stays inside until it closes,
Escape closes it, and focus returns to whatever opened it.

## Why
A modal that leaks focus to the page behind it strands keyboard and screen-reader
users — they tab into controls they can't see and lose their place. Proper focus
management (trap Tab, focus first control on open, Escape to close, restore focus on
close) is the baseline that makes every form in Floaty usable without a mouse.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. Tab to the **Add resource** button and press **Enter** (note this is the trigger —
   focus should come back to it later). The "Add resource" dialog opens.
2. Confirm focus is already on the first control inside the dialog (the **Name** field),
   not somewhere on the page behind it.
3. Press **Tab** repeatedly to walk the dialog's controls down to the last one
   (**Save**/**Cancel**), then **Tab** once more — focus wraps to the first control,
   not out to the sidebar.
4. Press **Shift+Tab** from the first control — focus wraps to the last control.
5. Press **Escape** — the dialog closes.
6. Confirm focus has returned to the **Add resource** button that opened it.

## Acceptance criteria
- ✅ On open, focus moves to the first focusable control inside the dialog.
- ✅ **Tab** from the last control wraps to the first; **Shift+Tab** from the first wraps
  to the last — focus never escapes the dialog.
- ✅ **Escape** closes the dialog.
- ✅ On close, focus is restored to the control that opened the dialog (**Add resource**).
- ✅ The dialog exposes `role="dialog"` with `aria-modal="true"` and is labelled by its
  title.
