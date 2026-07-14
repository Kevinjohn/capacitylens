# US-PRI-01 — Show private names according to account role

**Area:** Privacy / whole app · **Persona:** Account owner and agency member · **Coverage:**
`server/src/app.authz.test.ts` → "private client/project names — owner-only server projection";
`server/src/db.tenantStore.test.ts`; client/project/list/archived component tests (manual
cross-surface pass until a dedicated auth-backed E2E is added)

## Goal

Let the owner work with real confidential identities while every other account member sees only
consistent, clearly quoted code names everywhere those clients and projects appear.

## Why

An embargo fails if even one secondary surface leaks the real name—a filter, confirmation dialog,
archived row, allocation popover or API payload is enough. The role projection must therefore happen
at the server boundary and flow consistently through the whole interface, rather than relying on
individual screens to remember to hide names.

## How (end-to-end)

**Precondition:** In an auth-enabled server account, the owner has created private client
`Real Client Ltd` / code `Northstar` and private project `Secret Launch` / code `Aurora`, with an
activity and allocation under the project. The account also has an admin, editor and viewer.

1. Sign in as the **owner** and inspect Clients, Projects, filters/pickers, Schedule, the command
   palette and an edit form.
2. Sign in as the **admin**, then repeat as **editor** and **viewer**. Inspect the same surfaces and
   their network response from `GET /api/state?accountId=…`.
3. As an admin/editor, open an allowed edit form for a private row. As a viewer, confirm the normal
   whole-app read-only rules still remove edit affordances.
4. Archive a private row as a permitted role and inspect **Settings → Archived & deleted** and its
   confirmation dialogs.

## Acceptance criteria

- ✅ **PRI-DISPLAY-01 — Role matrix.**
  - **Owner:** receives and sees the real `name`, `isPrivate: true` and raw, unquoted `codeName`.
  - **Admin, editor and viewer:** receive `name` as exactly one straight-quoted code name
    (`"Northstar"` / `"Aurora"`), keep `isPrivate: true`, receive no `codeName`, and receive no real
    private name anywhere in the response body.
  - **Trusted local/demo and auth-off server:** are owner-equivalent because there is no membership
    identity to hide data from.
- ✅ **PRI-DISPLAY-02 — All surfaces.** The same quoted label flows through client/project lists; client and project filters/selects;
  compound `Client / Project` labels; scheduler allocation bars/popovers; forms; command-palette
  results; active, archived and deleted views; and archive/delete/purge confirmation copy.
- ✅ **PRI-DISPLAY-03 — Exactly one quote pair.** Display helpers never double-quote a projected name. A label or sentence that supplies its own
  quotes strips the projection's outer pair first, so `"Northstar"` never becomes `""Northstar""`.
- ✅ **PRI-DISPLAY-04 — Non-owner form.** An admin/editor editing an already-private row sees its quoted **Name** disabled, no privacy
  switch or raw code-name field, and `Only an account owner can change this private name.` Other
  fields remain editable according to the normal role tier. A viewer remains entirely read-only.
- ✅ **PRI-DISPLAY-05 — Independent composition.** A private client's and private project's independent projections compose correctly in every
  compound label; making one private never implicitly changes the other.
- ✅ **PRI-DISPLAY-06 — Public/scope invariants.** Public clients/projects and every non-client/project entity are unchanged. The built-in
  **Internal** client always remains public and continues to display as **Internal**.
- ✅ **PRI-DISPLAY-07 — Offline parity.** A non-owner offline snapshot contains the same projected labels returned by the server; it does
  not recreate or cache the removed real names/raw code names. An owner's snapshot may contain them.
