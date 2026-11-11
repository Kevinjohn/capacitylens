# US-DAT-03 — Keep imported data outside undo history

As an Owner, I want imports to stay outside undo history so that an accidental undo cannot replace imported company data.

**Status:** Current
**Access:** Owner on server; demo users in temporary demo
**Entry:** After import → Undo/Redo
**Documentation:** [Settings](../../docs-src/using/settings.md#beta-transfer-contract)
**Source:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx)

## Acceptance criteria

- Completing an import clears the Undo and Redo history, so neither can reverse the import or any earlier change.
