# US-PRJ-05 — Mark a project private with a code name

**Area:** Projects · **Persona:** Account owner · **Coverage:**
`src/components/projects/ProjectForm.test.tsx` + `shared/src/domain/privateNames.test.ts` (manual
end-to-end until a dedicated project privacy E2E is added)

## Goal

Plan an embargoed project under its real client relationship while showing the wider agency only a
safe project code name.

## Why

A known client can still have confidential work, and a confidential client can have projects with
different disclosure rules. Project privacy therefore needs its own owner-managed toggle; it cannot
be inferred from the client or allowed to weaken the rule that every project belongs to a client.

## How (end-to-end)

**Precondition:** Open the seeded demo at **Projects** (`/projects`). The trusted local/demo role is
owner-equivalent; *Acme Inc.* and *Globex* are available clients.

1. Click **Add project** and confirm **Use a code name** is off and **Code name** is absent.
2. Enter **Name** = `Acquisition Launch`, choose **Client** = *Acme Inc.*, and enable
   **Use a code name**.
3. Try to save with `“”` as **Code name**; confirm the form rejects it.
4. Enter `"Aurora"` and save.
5. Confirm the owner-facing Projects list shows **Acquisition Launch** under *Acme Inc.*, then reopen
   it and confirm the stored form value is `Aurora` without quotes.
6. Repeat with a public project under a private client, and a private project under a public client,
   to confirm the two privacy choices are independent.

## Acceptance criteria

- ✅ **PRJ-PRIV-01 — Public default.** Project privacy is off by default and has the same owner-only switch, conditional required field,
  placeholder, automatic-quotation hint and accessible validation as client privacy.
- ✅ **PRJ-PRIV-02 — Required normalised identity.** Quote-only/blank code names are rejected before save; valid straight/curly outer quotes are
  normalised out of storage.
- ✅ **PRJ-PRIV-03 — Full-fidelity storage.** A valid private project retains the real `name`, required `clientId`, colour, phases, activities
  and allocations, with `isPrivate: true` and an unquoted raw `codeName`.
- ✅ **PRJ-PRIV-04 — Required client.** The required-client invariant is unchanged: privacy never allows a project to save without a
  valid client.
- ✅ **PRJ-PRIV-05 — Independent privacy.** Client and project privacy are independent. A public project under a private client exposes only
  its public project name plus the client's code name to non-owners; a private project under a public
  client exposes the public client name plus the project's code name.
- ✅ **PRJ-PRIV-06 — Owner fidelity/declassification.** The owner sees and edits the real project name. Turning privacy off clears the optional privacy
  fields without changing the client relationship or downstream work.
- ✅ **PRJ-PRIV-07 — Scope boundary.** No other entity type—activities, phases, allocations, resources, disciplines or time off—gains
  these privacy fields or controls.
