# US-DAT-02 — Import a full beta JSON document

**Area:** Data management · **Persona:** Company Owner · **Linked E2E:** `e2e/data.spec.ts` → "previews a full document without writing and Cancel keeps the current company", "replaces the selected company in memory and a reload restores the demo seed"; `e2e/transfer.auth.spec.ts` → signed-in preview, confirmation and replacement

**Documentation:** [Settings — Import and export](../../docs-src/using/settings.md#import-and-export)

## Goal

Replace one company's planning records and supported settings from a full beta export, after a preview and explicit confirmation. Preserve stable entity IDs and existing member-to-person links. Leave other companies and sign-in records unchanged.

## Why

Import is a full replacement, not a merge. A mistaken destination or file can erase planning work, and Undo cannot reverse it. The Owner must see what will be replaced and confirm that particular operation.

## How (end-to-end)

**Precondition:** A full `capacitylens-beta` version `1` JSON file from **Export JSON**. In a signed-in installation, the current user is the selected company's Owner.

1. Open **Settings → Data and support → Import and export** and choose **Import JSON** (`data-testid="import-data"`).
2. Select the file. The preview checks the format, completeness, company scope, row values and links. Select **Continue** to obtain the current company revision.
3. Review the file name, record counts and replacement warning. **Cancel** leaves the company untouched.
4. Select **Replace data**. In a signed-in installation, confirm this exact file, destination and revision with a password or linked Google identity. After returning from Google, select the same file again, review its preview, and explicitly select **Replace data**. A different file cannot use the pending confirmation.
5. If another edit changed the company after preview, preview again. If the response is uncertain, the app reloads authoritative state before edits resume.

## Acceptance criteria

- The file has `format: "capacitylens-beta"`, schema version `1`, `completeness: "full"`, exactly one company and all scoped tables. Malformed, redacted, foreign, dangling or invalid data is refused without changing records; values are not repaired or remapped.
- The preview and confirmation name the file, show record counts and state that the selected company's data will be replaced. Cancel performs no replacement or proof spend.
- Only the Owner can import in a signed-in installation. A recent sign-in alone is insufficient. Each proof binds one action, principal, native session, company, document and revision; it cannot authorize another import or ownership transfer.
- The browser does not retain the selected import document across a Google redirect. Returning from Google requires selecting and reviewing the same file again; cancellation or a mismatched file leaves company data unchanged.
- A valid changed import retains IDs and member links, replaces supported company settings and scheduling rows atomically, clears deleted restoration groups, and records one planning revision and one audit entry. An unchanged import records neither.
- A stale revision or failed partial write leaves the previous company data in place. On failure the proof remains unspent, so the Owner can retry the same exact operation while it remains valid.
- The temporary demo applies the same strict document in page memory without a sign-in or server request. Other demo companies remain unchanged, and refresh restores the demo seed.
- The import is not undoable. The browser's device preferences and identity, membership, session and admission records are never part of the transfer file.
