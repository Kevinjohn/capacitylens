# US-DAT-02 — Import a dataset from JSON (confirm before replacing)

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/data.spec.ts` → "imports a dataset after a confirmation that summarises counts and warns it replaces all data"

## Goal
Load a previously exported dataset back into Floaty, after a confirmation step that summarises what's in the file and warns that importing replaces everything currently in the app.

## Why
Import is a full replace, not a merge — restoring a backup or loading a shared snapshot wipes the current dataset. Because that's destructive, the manager must see exactly what they're about to load and an explicit "this replaces all current data" warning before it happens, with an undo afterwards.

## How (end-to-end)
**Precondition:** Seeded app open. You have a valid Floaty JSON file to import — produce one first via **Export JSON** (US-DAT-01), which downloads `floaty-data.json`. (To prove the replace is visible, you may add or rename one entity before exporting so the imported set differs from the live one.)
1. In the sidebar **Data** section, click **Import JSON** (`data-testid="import-data"`). The OS file picker opens.
2. Choose the `floaty-data.json` file. The **"Import data?"** confirmation dialog appears.
3. Read the dialog: it names the file, states it **replaces all current data**, lists the file's entity counts (e.g. "5 resources, 3 disciplines, 2 clients, …, 1 time-off entries"), and says "You can undo this with ⌘Z."
4. Click **Cancel** the first time — the dialog closes and the live data is untouched (proves Cancel is safe).
5. Click **Import JSON** again, re-choose the file, and this time click **Replace data**.
6. The dialog closes; a success toast appears.

## Acceptance criteria
- ✅ Choosing a valid Floaty file opens a dialog titled **Import data?** with a **Replace data** confirm button and a **Cancel** button.
- ✅ The dialog names the chosen file and includes the phrase **"replaces all current data"**, the count summary (entities present in the file, in the form "N resources, N disciplines, …"; types with zero items are omitted), and the undo note "You can undo this with ⌘Z."
- ✅ Clicking **Cancel** leaves the current dataset completely unchanged (nothing is imported).
- ✅ Clicking **Replace data** swaps the live dataset for the file's contents and shows a success toast reading **"Imported floaty-data.json. Press ⌘Z to undo."** (the toast names the imported file and mentions ⌘Z).
- ✅ After replacing, the lists/schedule reflect the imported data, not the prior live data.
