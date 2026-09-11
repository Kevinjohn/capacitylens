# US-ALL-05 — Add a new activity inline from the modal

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "adds a new activity inline and uses it for the allocation"

## Goal

Opt in to adding a brand-new activity from inside the allocation modal, then immediately use it for the allocation without leaving the Schedule.

## Why

Agencies normally reuse activities created on the Activities page so names stay consistent. A workspace can opt in to inline creation when avoiding that context switch matters more.

**Documentation:** [Settings — Inline activity creation](../../docs-src/guide/settings.md#inline-activity-creation)

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`); set **Weeks visible** to **4 weeks** and click **Today** so the seed bars are in view.

1. Open **Settings**. Under **Activity creation**, turn on **Inline activity creation** for the workspace.
2. Return to **Schedule**, then click **+** on any row to open **New allocation** (or draw on a lane in Work mode).
3. Choose **Project** = _Queen Consolidated / Project Watchtower_. The inline field's placeholder reads _…or add a new activity_.
4. In that field (accessible name _New activity name_), type `Accessibility Audit`, then click **Add activity**.
5. Fill the remaining fields (dates, Hours / day) and click **Save**.

## Acceptance criteria

- ✅ Inline activity creation is off when the workspace has no saved preference. The **Activity** picker remains available for selecting existing activities.
- ✅ The workspace switch preserves an explicitly saved on or off choice. When enabled, the inline field appears and its placeholder follows the **Project** selection (`…or add a new internal activity`, `…or add a new all-projects activity`, or `…or add a new activity` for a real project).
- ✅ Typing a name and clicking **Add activity** creates the activity under the selected project and immediately selects it as the allocation's **Activity** (the **Activity** select now shows _Accessibility Audit_), and the input clears.
- ✅ The new activity is a real activity of that project — it appears on the **Activities** page and in the **Project-specific** group of the **Activity** dropdown afterwards.
- ✅ Clicking **Add activity** with an empty name creates no activity and shows "Enter a name for the new activity." With _Internal_ or _No specific project_ selected, a named **Add activity** creates the corresponding internal or All-projects activity.
- ✅ Saving with the newly-added activity selected creates an allocation bar labelled _Accessibility Audit_.
- ✅ The inline name and **Add activity** button remain side by side inside the allocation form's
  control column and stack with the surrounding fields without horizontal overflow on narrow screens.
