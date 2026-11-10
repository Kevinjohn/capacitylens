# US-DAT-04 — Reject invalid import files

As a company member, I want invalid import files rejected so that an accidental selection cannot replace my data.

**Status:** Current
**Access:** Owner on server; demo users in temporary demo
**Entry:** Settings → Import and export → Import JSON
**Documentation:** [Settings](../../docs-src/using/settings.md#import-and-export)
**Source:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx)

## Acceptance criteria

- The importer accepts only a valid full beta v1 document.
- Invalid or foreign documents are refused before replacement; current company data remains intact.
