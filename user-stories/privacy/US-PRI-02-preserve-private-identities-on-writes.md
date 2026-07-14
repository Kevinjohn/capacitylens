# US-PRI-02 — Preserve private identities across every server write path

**Area:** Privacy / server integrity · **Persona:** Account owner and permitted non-owner editor ·
**Coverage:** `server/src/app.authz.test.ts` → "private client/project names — owner-only server
projection" + `server/src/db.tenantStore.test.ts`

## Goal

Allow permitted non-owner changes to a private client/project without leaking or accidentally
replacing the owner-confidential real name and privacy settings.

## Why

Admins and editors receive a deliberately incomplete row: its visible `name` is the code-name
projection and raw `codeName` is absent. If that row were written back literally, an ordinary colour
or client-assignment edit could destroy the real identity. Responses are reads too, so conflict and
lifecycle payloads must be redacted with the same rigor as the main state endpoint.

## How (end-to-end)

**Precondition:** Use the auth-enabled account from US-PRI-01. Record the private rows directly from
an owner read (or the database), then sign in as an editor.

1. Read the projected private client/project as the editor.
2. Change an allowed non-private field (for example client/project colour or project client) through
   a normal PATCH and through a batch PUT that round-trips the projected row.
3. Attempt to send different `name`, `isPrivate` and `codeName` values as part of those writes.
4. Trigger an archive/unarchive response and an optimistic-concurrency `409` conflict.
5. As an editor/admin, attempt to create a new row carrying privacy fields; then repeat an update as
   the owner.

## Acceptance criteria

- ✅ **PRI-WRITE-01 — Pin protected fields.** On PUT, PATCH and batch updates to an existing private client/project by any non-owner writer,
  the server pins the stored real `name`, `isPrivate` and raw `codeName`; permitted ordinary fields
  still update successfully.
- ✅ **PRI-WRITE-02 — Strip non-owner creates.** Attempted privacy fields on a non-owner create are stripped, so an admin/editor may create only
  a normal public client/project. A viewer still cannot create anything under the existing write-tier
  authorization rules.
- ✅ **PRI-WRITE-03 — Owner authority.** An owner may create, rename, privatise, change the code name or make the row public. Owner-sent
  code names are normalised at the server boundary and stored without outer straight/curly quotation marks.
- ✅ **PRI-WRITE-04 — Redact every response.** Every response that can carry a private row applies the same role projection: ordinary create/
  update echoes, batch results, lifecycle archive/unarchive/delete responses, inactive-slice reads,
  export/state reads and the `current` row in a `409` optimistic-concurrency conflict.
- ✅ **PRI-WRITE-05 — Database fidelity.** No non-owner response body contains the real private name or raw `codeName`; each visible name
  has exactly one quote pair. The database retains the real name and raw code name after every path.
- ✅ **PRI-WRITE-06 — Tenant boundary.** Protection is independently tenant-scoped and server-authorized. Possessing a projected row or
  guessing another account's identifiers never grants read/write access to its protected values.
- ✅ **PRI-WRITE-07 — Server backstop.** The UI hiding controls is convenience only; the server preserves these invariants when called
  directly or when a client sends stale, malformed or deliberately hostile privacy fields.
