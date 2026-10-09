# US-SET-12 — Inline archives and deleted records

**Area:** Lifecycle · **Persona:** Studio manager / admin · **Linked E2E:** `e2e/archived.spec.ts` → archive, restore and soft-delete a resource

**Documentation:** [Resources](../../docs-src/using/resources.md)

## Goal

Give owners and administrators an expanded archive section at the bottom of each Resources, Clients,
Projects and Activities list, where they can restore an accidental archive immediately or **delete**
it to start the purge countdown. Settings does not show a Deleted items section.

## Why

Archiving (the per-row action on each management list) is the reversible "remove from the schedule"
step; it deliberately does NOT destroy data. The archive section on the same page makes hidden rows
visible again so they can be brought back or moved further down the lifecycle. Soft-delete
anonymises a resource (replaces the name with _"Removed person #…"_) and starts a 30-day grace window;
only after that window — and only for an admin — can a tombstone be physically purged with its
children. Keeping the destructive steps gated, staged and clearly labelled means an accidental
removal is always recoverable for at least 30 days, and personal data is scrubbed the moment a row is
deleted.

## How (end-to-end)

**Precondition:** Seeded in-memory demo open (`VITE_CAPACITYLENS_DEMO=1` — no server needed). The
lifecycle store actions mutate temporary demo data, so an archived row hides immediately and
surfaces here.

1. On **Resources**, archive **Barry Allen** via the row's **Archive Barry Allen** button → confirm
   **Archive** in the _"Archive resource?"_ dialog. The row disappears from Resources and from the
   **Schedule**.
2. In the resource archive sections (`data-testid="archived-resources-section"`), find Barry under
   **Archived Studio**, using `data-testid="archived-row"`.
3. Click **Restore Barry Allen** — the row leaves the section and Barry reappears on the Schedule and
   the Resources list.
4. Re-archive Barry and on the archived row click **Delete Barry
   Allen** → confirm **Delete** in the _"Delete this item?"_ dialog.
5. The deleted resource leaves the inline archive. Its tombstone remains in company data and the
   original name has been scrubbed.

## Acceptance criteria

- ✅ Each list's archive section is expanded and visible only to owners/admins. Resources groups
  inactive rows as Archived Studio, Archived Supplementary, Archived External, then Archived placeholders
  when present. A non-admin/viewer never receives or sees inactive rows.
- ✅ Settings does not show a Deleted items section. Existing lifecycle actions and their access
  rules remain enforced on the entity pages and server.
- ✅ **Restore** on an archived row returns it to active (reappears on the schedule + its list).
- ✅ **Delete** on an archived row soft-deletes it (a confirm first): it moves to the deleted state,
  and a **resource's name is scrubbed** to _"Removed person #…"_. There is **no Restore** on a
  tombstone.
- ✅ No Settings UI currently exposes permanent deletion. The underlying store and server purge
  operations still enforce `PURGE_MIN_AGE_DAYS` and authorization tiers.
- ✅ Permanently deleting a client or project removes its owned project-specific work. A shared
  All-projects allocation survives with its project attribution cleared.
- ✅ In **server mode** each action POSTs the dedicated route (`POST /api/:entity/:id/{archive,
unarchive,delete,purge} {accountId}`) and reloads the active slice; the server enforces the
  interlocks (delete-needs-archived, purge tier + 30 days, PII scrub) regardless of the UI. In
  the **in-memory demo** the actions run against the temporary local store. An auth-off deployment
  is still server mode and uses the API routes with its documented open-access posture.
- ✅ The built-in **Internal** client can never be archived/deleted/purged (store + server backstop).
