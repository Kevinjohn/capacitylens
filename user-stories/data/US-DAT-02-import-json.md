# US-DAT-02 — Import a dataset from JSON (confirm before replacing)

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/data.spec.ts` → "import shows a confirmation that replaces all data; Cancel keeps the data", "confirming an import replaces the dataset and ⌘Z restores it"

**Documentation:** [Settings — Import and export](../../docs-src/using/settings.md#import-and-export)

## Goal

Load previously exported scheduling records into the current company, after a confirmation step
that summarises the file and warns that importing replaces that company's scheduling records.

## Why

Import is a full replace, not a merge — restoring a backup or loading a shared snapshot wipes the current dataset. Because that's destructive, the manager must see exactly what they're about to load and an explicit "this replaces this company's data" warning before it happens, with an undo afterwards.

## How (end-to-end)

**Precondition:** Seeded app open. You have a valid CapacityLens JSON file to import — produce one first via **Export JSON** (US-DAT-01), which downloads `capacitylens-data.json`. (To prove the replace is visible, you may add or rename one entity before exporting so the imported set differs from the live one.)

1. Open **Settings**, find **Data and support → Import and export**, expand it and click **Import JSON**
   (`data-testid="import-data"`). The OS file picker opens.
2. Choose the `capacitylens-data.json` file. The **"Import data?"** confirmation dialog appears.
3. Read the dialog: it names the file, states it **replaces this company's data**, lists the file's entity counts (e.g. "5 resources, 3 disciplines, 2 clients, …, 1 time-off entries"), and says "You can undo this with ⌘Z."
4. Click **Cancel** the first time — the dialog closes and the live data is untouched (proves Cancel is safe).
5. Click **Import JSON** again, re-choose the file, and this time click **Replace data**.
6. The dialog closes; a success toast appears.
7. If another request changes this company while the server prepares the replacement, observe the
   conflict notice, confirm the newer change remains, and retry from the latest company data.
8. If server import capacity is temporarily exhausted, observe the busy notice and retry later;
   abandoning the request must cancel its queued or active preparation work.

## Acceptance criteria

- ✅ Malformed JSON is refused by the server parser before replacement; existing company data stays
  intact. Request-size handling follows the Adonis BodyParser default for the installed version.
  Recognized legacy record values may still be repaired or skipped during an accepted import.
- ✅ Choosing a valid CapacityLens file opens a dialog titled **Import data?** with a **Replace data** confirm button and a **Cancel** button.
- ✅ The dialog names the chosen file and includes the phrase **"replaces this company's data"**, the count summary (entities present in the file, in the form "N resources, N disciplines, …"; types with zero items are omitted), and the undo note "You can undo this with ⌘Z."
- ✅ Clicking **Cancel** leaves the current dataset completely unchanged (nothing is imported).
- ✅ Clicking **Replace data** swaps the live dataset for the file's contents and shows a success toast reading **"Imported N records. Press ⌘Z to undo."** (the toast reports how many records were imported — adding "(K invalid records skipped)" if any were dropped — and mentions ⌘Z).
- ✅ After replacing, the lists/schedule reflect the imported data, not the prior live data.
- ✅ The destination company's settings, including date format, and this browser's display
  preferences remain unchanged. In signed-in server deployments, import is restricted to Owners.
- ✅ A company change committed during server-side import preparation makes the import fail with a
  retryable conflict notice; the committed change remains stored and ordinary writes resume.
- ✅ Server import preparation is concurrency- and queue-bounded; abandoned work is cancelled, and
  saturation returns a retryable busy response without starting another worker.

## Beta transfer preparation contract

- ✅ The beta parser accepts only `format: "capacitylens-beta"` and schema version `1`; the version
  is independent of database and legacy export versions.
- ✅ The document includes all `AppData` tables, exactly one account and all scoped rows. It
  preserves IDs, timestamps and settings. It excludes identity, sessions, membership, roles,
  admission records and device preferences.
- ✅ Preparation rejects invalid dates or scalars, duplicate table IDs, dangling references,
  mismatched account scope, and current member links that do not point to an imported person
  resource. It does not remap IDs or repair records.
- ✅ A beta import accepts only `completeness: "full"`; a redacted export is not a restorable full
  replacement. The document must include exactly one canonical, public, active **Internal** client.
- ✅ Preparation checks the exported account against the selected destination account and checks
  current member-to-person resource links. Backend activation must retain those links and provide
  privileged authorization proof, a destination revision recheck and an atomic replacement.

This slice implements the shared beta contract and a frontend preview only. The current Settings
flow continues to use the legacy importer until backend writer replacement is integrated. The
accepted replacement map is [recorded under issue
#1482](https://github.com/Kevinjohn/capacitylens/issues/1482#issuecomment-6276475651); see also
[implementation issue #1520](https://github.com/Kevinjohn/capacitylens/issues/1520).
