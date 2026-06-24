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
1. Find the **Brand System** allocation bar (a *Brand Themes* activity on *Pam Gonzalez*).
2. Drag it onto the **Senior Designer** row — the placeholder bound to *Project
   Lightning* (`data-resource-id="r-ph-designer"`). Its row highlights as a drop target
   mid-drag.
3. Release. The reassignment is rejected (a Lightning-bound placeholder can't take a
   *Brand Themes* activity), and a dismissible notice appears at the bottom-centre reading
   **"A placeholder can only be assigned to activities from its bound project."**
4. This is an error notice, so it stays put rather than timing out — the reason remains
   readable until you act on it. Click its **✕** (aria-label "Close toast") and it
   disappears immediately.
5. To see auto-dismiss, trigger an *info* notice instead: drag a bar to a legal slot (or
   import a dataset — see the variant below). That confirmation toast clears itself after
   roughly 4 seconds without any interaction.

## Acceptance criteria
- ✅ The rejected drag produces a dismissible notice (a toast in the bottom-centre live
  region) surfacing the reason message. (Toasts surface through a single
  `aria-live="polite"` region — they carry no per-toast `role`, and notably no
  per-tone `role="alert"`; assert by visible text, not by role.)
- ✅ Being an error notice, the rejected-drag toast stays until dismissed; clicking its
  **✕** (aria-label "Close toast") removes it immediately.
- ✅ An *info* toast (a confirmation, e.g. a legal move or an import) auto-dismisses on its
  own after roughly 4 seconds.
- ✅ No toast blocks the page — the schedule behind it stays interactive.
- ✅ (Variant) Importing a dataset surfaces a transient info toast that auto-dismisses the
  same way.
