# US-DAT-03 — Undo an import

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/data.spec.ts` → "confirming an import replaces the dataset and ⌘Z restores it"

## Goal
After a confirmed import has replaced the dataset, press ⌘Z to bring back exactly the data that was there before the import.

## Why
Import is a full replace, so a wrong file or a mistimed click can blow away the live plan. A single undo is the safety net: the manager can recover the previous dataset instantly without having re-exported it first, which makes trying an import low-risk.

## How (end-to-end)
**Precondition:** Seeded app open. Have a valid CapacityLens file to import (e.g. the `capacitylens-data.json` from US-DAT-01). To make the change obvious, first add a clearly identifiable entity to the *current* app — e.g. a client named **Marker Co.** on the Clients page — that is **not** in the import file.
1. Confirm **Marker Co.** exists in the current data (Clients list).
2. In the sidebar **Data** section, click **Import JSON**, choose the file, and click **Replace data** in the "Import data?" dialog.
3. The dataset is replaced; the success toast "Imported … Press ⌘Z to undo." appears. **Marker Co.** is now gone (it wasn't in the file).
4. Press **⌘Z** (Undo).

## Acceptance criteria
- ✅ Immediately after the confirmed import, the live data is the file's contents (the pre-import marker, **Marker Co.**, is absent).
- ✅ Pressing **⌘Z** restores the entire pre-import dataset in one step — **Marker Co.** reappears and any other pre-import entities/allocations/time-off return.
- ✅ The restore is whole-dataset, not partial: the lists and the Schedule (Jump to date → 2026-06-01) match the state from just before the import.
