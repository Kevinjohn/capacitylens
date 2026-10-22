# US-DAT-05 — Server data persists across reload

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/persistence.db.spec.ts`

## Goal

Create or edit a record in the server-backed app, reload, and see the committed value again.

## Why

A successful save must mean the server owns the change durably. Reloading is the simplest
user-visible proof that the value came back from SQLite rather than surviving only in page memory.

## How (end-to-end)

**Precondition:** Sign in to the server-backed app and open its company.

1. Add a client and save it.
2. Reload the page, reselect the company, and confirm the client remains.
3. Rename that client, save, and reload again.
4. Archive the client, reload, and inspect active and inactive views.
5. While a newly created lifecycle row is still saving, remove it and close or hide the page.

## Acceptance criteria

- ✅ A saved client survives a full reload through SQLite.
- ✅ A saved rename survives a full reload.
- ✅ An archived row remains hidden after reload and still exists in inactive data.
- ✅ A page-closing lifecycle archive cannot be overtaken by its older in-flight creation.
- ✅ If a page that survives through back/forward cache restores a row after its confirmed teardown
  archive, the next save durably unarchives the row before becoming clean. Scheduler Undo/Redo covers
  bookings only and does not perform this restore.
- ✅ The in-memory demo stays editable, including booking changes and Undo/Redo, but stores its data
  only for the current page. Reload restores its canonical seed and clears its history.
