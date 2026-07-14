# US-KBD-05 — Field-level error association

**Area:** Keyboard & accessibility · **Persona:** Screen-reader user · **Linked E2E:** `e2e/accessibility.spec.ts` → "an invalid field is marked aria-invalid and described by the error"

## Goal
When a form field is invalid, have the error tied to that specific field — not just
printed at the bottom of the form — so assistive tech announces it on the field.

## Why
A validation message shown only at the foot of a dialog is easy to miss and isn't
linked to the control that's wrong. A screen-reader user lands on the field with no
idea why Save failed. Marking the offending field `aria-invalid="true"` and pointing
its `aria-describedby` at the error's element makes the message announce as part of the
field, so the fix is obvious to everyone.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** → **Add resource**.
1. Leave **Name** empty (a person requires a name) and click **Save**.
2. The dialog stays open and an inline error appears (e.g. "Name is required for a
   person."), rendered as an `alert` with its own id.
3. Inspect the **Name** input (DevTools): it now has `aria-invalid="true"` and an
   `aria-describedby` whose value equals the id of that error element.
4. Confirm the same wiring on another field — e.g. set **Working hours / day** = `0`
   and Save; the hours field gets `aria-invalid` and points at the error.
5. Fix the field (type a valid value) and Save — the field clears `aria-invalid` and
   the association/error is gone.

## Acceptance criteria
- ✅ An invalid field gets `aria-invalid="true"`.
- ✅ That field's `aria-describedby` equals the `id` of the error element
  (`role="alert"`), so the message is programmatically tied to the field.
- ✅ The error is associated with the offending field, not only shown at the bottom of
  the form.
- ✅ A valid field has neither `aria-invalid="true"` nor an `aria-describedby` pointing
  at an error (the association clears once the field is corrected).
