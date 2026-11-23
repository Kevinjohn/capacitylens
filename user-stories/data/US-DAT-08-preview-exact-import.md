# US-DAT-08 — Confirm the exact import operation

As an Owner, I want to confirm the exact import operation so that my password cannot authorise a different replacement.

**Status:** Current
**Access:** Owner
**Entry:** Import preview → Replace data → password confirmation
**Documentation:** [Settings](../../docs-src/using/settings.md#import-and-export)
**Source:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx)

## Acceptance criteria

- Use the **Password** field in [Import company data](US-DAT-02-import-json.md). **Continue** confirms this previewed import; **Cancel** leaves the data unchanged.

## User flow

```mermaid
flowchart TD
  preview["Review import preview → Replace data"] --> password["Enter current Password → Continue"]
  password --> apply["The exact previewed import proceeds"]
  preview --> cancel["Cancel returns without changing company data"]
```

## Code flow

```mermaid
flowchart TD
  review["ImportExport Replace data opens PasswordConfirmationDialog with import intent"] -->|Cancel| back["Return to Replace data"]
  review -->|Submit password| issue["PasswordConfirmationsController.store normalizes the document and checks live Owner access outside View as member"]
  issue --> kit["confirmPassword issues five-minute single-use proof bound to credential, identity, session, company and exact intent"]
  kit -->|Wrong password or throttled| refusal["Show refusal in the password dialog"]
  issue -->|Authorization or document refused| refusal
  kit -->|confirmationId| send["useServerImport sends document, baseRevision and proof after suspending planning writes"]
  send -->|Planning blocked| blocked["Surface notice without sending"]
  send -->|Dispatched| tx["ImportsController.store rechecks authority and consumes matching proof in apply transaction"]
  tx -->|Expired, mismatched or stale| reject["Refuse; a rolled-back write leaves proof unspent"]
  tx -->|Accepted unchanged| same["Commit proof spend and keep existing revision/history"]
  tx -->|Accepted changed| changed["Commit proof spend and company replacement"]
  send -->|Uncertain result| boundary["Use the import recovery path"]
  changed --> boundary
```

See [Preview and replace company data](US-DAT-02-import-json.md#code-flow) for reconciliation after dispatch.

**Code references:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx#L233) · [PasswordConfirmationDialog.tsx](../../apps/frontend/src/auth/PasswordConfirmationDialog.tsx#L1) · [password_confirmation.ts](../../apps/backend/app/services/auth/password_confirmation.ts#L33) · [password_confirmations_controller.ts](../../apps/backend/app/controllers/password_confirmations_controller.ts#L18) · [imports_controller.ts](../../apps/backend/app/controllers/imports_controller.ts#L17) · [company_import.ts](../../apps/backend/app/services/company_import.ts#L145) · [import_apply.spec.ts](../../apps/backend/tests/functional/import_apply.spec.ts#L343) · [import_apply.spec.ts](../../apps/backend/tests/functional/import_apply.spec.ts#L491) · [import_apply.spec.ts](../../apps/backend/tests/functional/import_apply.spec.ts#L667)
