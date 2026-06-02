# US-NAV-05 — Transient toast that auto-dismisses

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked E2E:** `e2e/data.spec.ts` (an import surfaces a toast); the auto-dismiss timing is manual

## Goal
Get a short, non-blocking message when an action is rejected or completes (e.g. a
disallowed drag, or an import), and have it clear itself after a few seconds.

## Why
Some actions can't go through — most usefully, dropping an allocation onto a
placeholder bound to a different project. The user needs to know *why* it didn't stick
without a modal interrupting their flow. A toast announces the reason, then gets out of
the way on its own (or on demand) so the schedule stays the focus.

## How (end-to-end)
**Precondition:** Seeded app open at Schedule (`/`). Click **4w** so more of the
timeline is visible, then scroll the grid fully left if the seed bars aren't in view.
1. Find the **Brand System** allocation bar (a *Brand Themes* task on *Pam Gonzalez*).
2. Drag it onto the **Senior Designer** row — the placeholder bound to *Project
   Lightning* (`data-resource-id="r-ph-designer"`). Its row highlights as a drop target
   mid-drag.
3. Release. The reassignment is rejected (a Lightning-bound placeholder can't take a
   *Brand Themes* task), and a toast appears at the bottom-centre reading
   **"A placeholder can only be assigned to tasks from its bound project."**
4. Leave it untouched and wait ~4 seconds — the toast fades out on its own.
5. Trigger another toast (repeat the rejected drag) and this time click its **✕**
   ("Dismiss") button. It disappears immediately.

## Acceptance criteria
- ✅ The rejected drag produces a toast (`role="alert"`) with the reason message.
- ✅ Left alone, the toast auto-dismisses after roughly 4 seconds.
- ✅ Clicking the toast's **✕** (aria-label "Dismiss") removes it immediately.
- ✅ The toast does not block the page — the schedule behind it stays interactive.
- ✅ (Variant) Importing a dataset likewise surfaces a transient toast that
  auto-dismisses the same way.
