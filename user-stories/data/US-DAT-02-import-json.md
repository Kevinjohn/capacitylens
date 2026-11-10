# US-DAT-02 — Preview and replace company data

As an Owner, I want to preview and replace company data so that I can restore a valid full export into this company.

**Status:** Current
**Access:** Owner on server; demo users in temporary demo
**Entry:** Settings → Import and export → Import JSON
**Documentation:** [Settings](../../docs-src/using/settings.md#import-and-export)
**Source:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx), [BetaImportPreview.tsx](../../apps/frontend/src/components/import-export/BetaImportPreview.tsx), [PasswordConfirmationDialog.tsx](../../apps/frontend/src/auth/PasswordConfirmationDialog.tsx)

## Acceptance criteria

| Field       | Control                               | Required/default/conditions                                       |
| ----------- | ------------------------------------- | ----------------------------------------------------------------- |
| Import JSON | JSON file chooser                     | Required; accepts application/json; must be a full beta v1 export |
| Password    | Password input in confirmation dialog | Required on server; confirms this import for the signed-in Owner  |

Continue previews the company and record count without changing data. Cancel closes the preview. Replace data applies the reviewed file; in server mode, Continue in the password dialog confirms it.

- Cancel, invalid input or a stale revision leaves data unchanged. Server import is Owner-only; demo import stays temporary.
