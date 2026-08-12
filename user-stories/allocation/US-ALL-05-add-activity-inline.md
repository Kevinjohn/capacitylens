# US-ALL-05 — Add a new activity inline from the modal

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "adds a new activity inline and uses it for the allocation"

## Goal

Add a brand-new activity to the selected project from inside the allocation modal, and immediately use it for the allocation — without leaving to the Activities page.

## Why

When booking work, the right activity often doesn't exist yet. Forcing the manager to abandon the modal, go to Activities, create it, then come back is friction. Adding the activity inline keeps the scheduling flow uninterrupted.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`); set **Weeks visible** to **4 weeks** and click **Today** so the seed bars are in view.

1. On any row, click **+** to open **New allocation** (or draw on a lane in Work mode).
2. Choose **Project** = _Queen Consolidated / Project Watchtower_. (The inline activity field is always present; with a real project chosen its placeholder reads _…or add a new activity_.)
3. In the **…or add a new activity** field (accessible name _New activity name_), type `Accessibility Audit`.
4. Click **Add activity**.
5. Fill the remaining fields (dates, Hours / day) and click **Save**.

## Acceptance criteria

- ✅ The inline activity field is always present; its placeholder follows the **Project** selection (`…or add a new internal activity`, `…or add a new cross-project activity`, or `…or add a new activity` for a real project).
- ✅ Typing a name and clicking **Add activity** creates the activity under the selected project and immediately selects it as the allocation's **Activity** (the **Activity** select now shows _Accessibility Audit_), and the input clears.
- ✅ The new activity is a real activity of that project — it appears on the **Activities** page and in the **Activity** dropdown afterwards.
- ✅ Clicking **Add activity** with an empty name creates no activity and shows "Enter a name for the new activity." With _Internal_ or _Any Project_ selected, a named **Add activity** creates the corresponding internal or cross-project activity.
- ✅ Saving with the newly-added activity selected creates an allocation bar labelled _Accessibility Audit_.
