# US-SET-08 — Clear local storage

**Area:** Settings · **Persona:** Studio manager / operator · **Linked E2E:** `e2e/clear-local-storage.spec.ts` → "shows a destructive button + confirm modal; Cancel does not wipe"

## Goal
From Settings, deliberately wipe everything Floaty has cached in **this browser** — the data blob and
all per-browser preferences — behind a clear destructive confirmation, then start fresh on reload.

## Why
Floaty is local-first: a data blob plus a handful of preference keys live in this browser's
localStorage. Sometimes you want a clean slate — a wedged local dataset, a shared/demo machine you're
handing on, or a stale cache against a hosted site. On the **hosted/live** site the real data lives in
the database, so clearing the browser cache is safe (the app reloads from the DB); in **local mode**
this browser holds your only copy, so the action erases your data. The button makes that distinction
explicit and gates the wipe behind the same destructive confirm used for deletes — there is no undo.

## How (end-to-end)
**Precondition:** Seeded app open (clock inside the seed window — see *Seed data* in REFERENCE.md).

1. Open **Settings** (sidebar). Scroll to the bottom — there is a danger-styled **Local data** section
   with a red **Clear local storage** button (`data-testid="clear-local-storage"`).
2. Read the section copy. In the default (local) build it warns this is your only copy and the wipe
   cannot be undone. (On a hosted build with a server backend it instead says your data is in the
   database and the app will reload from there.)
3. Click **Clear local storage**. A confirm dialog opens — title **Clear local storage?**, a danger
   **Clear local storage** confirm button and **Cancel** — restating that it clears Floaty data +
   settings in **THIS browser** and **cannot be undone**.
4. Click **Cancel**. The dialog closes and **nothing changes** — your data, settings and the page are
   all intact (no reload). The button is still there.
5. *(Not exercised in E2E — it would wipe the test context.)* Clicking **Clear local storage** in the
   confirm dialog removes every `floaty/`-prefixed localStorage key (the data blob + all device prefs,
   leaving unrelated keys alone) and reloads the page; the app re-initialises from the server database
   (hosted) or an empty/seeded dataset (local mode).

## Acceptance criteria
- ✅ Settings shows a danger-styled **Local data** section with a **Clear local storage** button
  (`data-testid="clear-local-storage"`).
- ✅ The button's section copy and the confirm-dialog copy are accurate to the mode (database-safe +
  reload on the hosted site; erases your only copy in local mode) and both state it affects **this
  browser** and **cannot be undone**.
- ✅ Clicking the button opens the standard destructive confirm dialog; **Cancel is a no-op** — no
  storage is cleared and the page does not reload.
- ✅ Confirming clears every `floaty/`-prefixed localStorage key (data blob + device prefs), leaves
  unrelated origin keys, and reloads so the app re-initialises from its source of truth.
