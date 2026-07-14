# US-CLI-05 — Mark a client private with a code name

**Area:** Clients · **Persona:** Account owner · **Linked E2E:** `e2e/clients.spec.ts` →
"an owner can add a private client with a code name" · **Additional coverage:**
`src/components/clients/ClientForm.test.tsx` + `shared/src/domain/privateNames.test.ts`

## Goal

Keep an embargoed client's real name in CapacityLens while giving the wider agency a safe code name
to use until the embargo ends.

## Why

Agencies often need to plan confidential pitches, launches and acquisitions before most of the team
may know the client. Replacing the real name in the database would make the record unreliable for
the owner; displaying it to everybody would break the embargo. The privacy control must preserve
both identities and make the safe one unmistakable.

## How (end-to-end)

**Precondition:** Open the seeded demo at **Clients** (`/clients`). The trusted local/demo role is
owner-equivalent. For a real role check, use an auth-enabled server and sign in as the account owner.

1. Click **Add client** and confirm **Use a code name** is off and no **Code name** field is shown.
2. Enter **Name** = `Embargoed Client Ltd`, enable **Use a code name**, and read the owner-only
   explanation and `Quotation marks are added automatically.` hint.
3. Enter `""` as **Code name** and click **Save**. Confirm the dialog remains open with a field error.
4. Enter ` “Northstar” ` and save again.
5. Confirm the owner-facing list still reads **Embargoed Client Ltd**, then edit that row.
6. Confirm privacy is on and **Code name** contains `Northstar` without quotation marks.
7. Turn privacy off and save; reopen the row to confirm it is public and the stale code name is gone.

## Acceptance criteria

- ✅ **CLI-PRIV-01 — Public default.** New clients are public by default: `isPrivate` and `codeName` are absent until an owner enables
  the switch.
- ✅ **CLI-PRIV-02 — Owner control.** Only an account owner (plus trusted local/auth-off owner-equivalent mode) is offered **Use a
  code name**. Enabling it reveals a required **Code name** field with placeholder `e.g. Northstar`.
- ✅ **CLI-PRIV-03 — Required safe identity.** A missing, whitespace-only or quote-only code name is rejected, keeps the dialog open and marks
  **Code name** `aria-invalid`; the client is not created or partially saved.
- ✅ **CLI-PRIV-04 — Normalised storage.** Straight/curly outer quotation marks and surrounding whitespace are removed before storage.
  `name` remains `Embargoed Client Ltd`, `isPrivate` is `true`, and raw `codeName` is `Northstar`.
- ✅ **CLI-PRIV-05 — Owner fidelity.** The owner continues to see the real client name and may edit either identity. Quotation marks are
  presentation only and are never stored in `codeName`.
- ✅ **CLI-PRIV-06 — Safe declassification.** Turning privacy off removes both optional privacy fields while preserving the real name, colour,
  projects and all downstream work.
- ✅ **CLI-PRIV-07 — Internal exclusion.** Privacy is available only for normal clients; the built-in **Internal** client can never be
  marked private.
