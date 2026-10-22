# US-DAT-03 — ⌘Z after an import keeps the imported data

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/data.spec.ts` → "confirming an import replaces the dataset, and ⌘Z leaves it imported"

**Documentation:** [Settings — Import and export](../../docs-src/using/settings.md#everything-else-on-the-page)

## Goal

After a confirmed import has replaced the dataset, pressing ⌘Z leaves the imported data in place.

## Why

Undo and Redo currently cover booking changes only. An import is not a booking change, so ⌘Z must
not appear to reverse it, and the import confirmation and toast do not promise an undo. Export the
current data first if you may need it back.

## How (end-to-end)

**Precondition:** Seeded app open. Have a valid CapacityLens file to import (e.g. the `capacitylens-data.json` from US-DAT-01). To make the change obvious, first add a clearly identifiable entity to the _current_ app — e.g. a client named **Marker Co.** on the Clients page — that is **not** in the import file.

1. Confirm **Marker Co.** exists in the current data (Clients list).
2. Open **Settings** → **Import and export**, expand it, click **Import JSON**, choose the file, and
   click **Replace data** in the "Import data?" dialog.
3. The dataset is replaced; the success toast "Imported … records." appears. **Marker Co.** is now gone (it wasn't in the file).
4. Press **⌘Z**.

## Acceptance criteria

- ✅ Immediately after the confirmed import, the live data is the file's contents (the pre-import marker, **Marker Co.**, is absent).
- ✅ Pressing **⌘Z** leaves the imported dataset in place — **Marker Co.** stays absent and the imported entities remain on the lists and the Schedule.
