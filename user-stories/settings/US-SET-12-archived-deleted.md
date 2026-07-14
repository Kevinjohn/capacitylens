# US-SET-12 — Archived & deleted (restore / delete / permanently delete)

**Area:** Settings · **Persona:** Studio manager / admin · **Linked E2E:** `e2e/archived.spec.ts` → "archive a resource → it vanishes from the schedule + list → Settings shows it → restore → re-archive → delete → tombstone (purge locked)"

## Goal
Give an admin one place — **Settings → Archived & deleted** — to see the resources, clients and
projects that have been removed from the schedule, and to **restore** them, **delete** (anonymise +
start the purge countdown) them, or — once the 30-day grace has passed — **permanently delete** them.

## Why
Archiving (the per-row action on each management list) is the reversible "remove from the schedule"
step; it deliberately does NOT destroy data. The admin view is the counterpart that makes the hidden
rows visible again so they can be brought back or moved further down the lifecycle. Soft-delete
anonymises a resource (replaces the name with *"Removed person #…"*) and starts a 30-day grace window;
only after that window — and only for an admin — can a tombstone be physically purged with its
children. Keeping the destructive steps gated, staged and clearly labelled means an accidental
removal is always recoverable for at least 30 days, and personal data is scrubbed the moment a row is
deleted.

## How (end-to-end)
**Precondition:** Seeded app open (LOCAL/default deploy — no server needed). The lifecycle store
actions mutate the local data, so an archived row hides immediately and surfaces here.
1. On **Resources**, archive **Alex Rivera** via the row's **Archive Alex Rivera** button → confirm
   **Archive** in the *"Archive resource?"* dialog. The row disappears from Resources and from the
   **Schedule**.
2. Open **Settings**. The **Archived & deleted** section (`data-testid="archived-section"`) lists Alex
   under **Archived** (`data-testid="archived-row"`) with a type tag (**Resource**).
3. Click **Restore Alex Rivera** — the row leaves the section and Alex reappears on the Schedule and
   the Resources list.
4. Re-archive Alex from Resources, return to Settings, and on the archived row click **Delete Alex
   Rivera** → confirm **Delete** in the *"Delete this item?"* dialog.
5. Alex now appears under **Deleted** (`data-testid="deleted-row"`) with the obfuscated name
   **"Removed person #…"** (the original name is gone). Its **Delete permanently**
   (`data-testid="archived-purge"`) button is **disabled**, with the hint *"Can be permanently deleted
   30 days after deletion"* (the tombstone is brand-new, < 30 days).
6. (After 30 days, or for an older tombstone) the **Delete permanently** button is enabled; clicking
   it and confirming the strong *"Permanently delete?"* dialog removes the row and its children for
   good.

## Acceptance criteria
- ✅ The **Archived & deleted** section shows in **local mode** (always) and in **server mode** for an
  **admin** (it self-hides on a **403** from the `?includeInactive=1` read — a non-admin/viewer never
  sees it). It reads inactive rows from the store (local) or that fetch (server).
- ✅ It partitions inactive resources/clients/projects into **Archived** (`archived-row`) and
  **Deleted** (`deleted-row`) groups, each row showing the name + a type tag; an **empty state**
  (*"Nothing archived or deleted."*) shows when nothing is inactive.
- ✅ **Restore** on an archived row returns it to active (reappears on the schedule + its list).
- ✅ **Delete** on an archived row soft-deletes it (a confirm first): it moves to the Deleted group,
  and a **resource's name is scrubbed** to *"Removed person #…"*. There is **no Restore** on a
  tombstone.
- ✅ **Delete permanently** on a tombstone is **disabled** with the locked hint until it is ≥ 30 days
  old (`PURGE_MIN_AGE_DAYS`); once eligible it is enabled and requires a strong confirm. It is shown
  only to a caller who **may purge** (always in OFF/local; admin+ on an auth-on server).
- ✅ In **server mode** each action POSTs the dedicated route (`POST /api/:entity/:id/{archive,
  unarchive,delete,purge} {accountId}`) and reloads the active slice; the server enforces the
  interlocks (delete-needs-archived, purge tier + 30 days, PII scrub) regardless of the UI. In
  **local/OFF mode** the actions run against the local store.
- ✅ The built-in **Internal** client can never be archived/deleted/purged (store + server backstop).
