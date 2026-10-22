# US-SET-18 — Hand the company to another Admin

**Area:** Team & access · **Persona:** Company Owner ·
**Linked E2E:** `e2e/ownership-transfer.auth.spec.ts` → Owner confirms a transfer and the two roles
swap immediately

## Goal

Let the current Owner transfer company ownership to an eligible Admin in one confirmed action.

**Guide:** [Owner responsibilities → Transfer ownership](../../docs-src/owner/responsibilities.md#transfer-ownership)

## Why

Ownership carries authority to delete the company or replace its data. The Owner makes this decision
and the interface must state its immediate effect: the selected Admin becomes Owner and the current
Owner becomes Admin. The nominated Admin does not separately authenticate or consent to the change.

## How (end-to-end)

**Precondition:** Server mode with authentication on. Bruce Wayne is the current Owner and Selina
Kyle is an active, unrestricted Admin in the same company.

1. Bruce opens **Team & access → Company ownership**. The Owner-only card
   (`data-testid="ownership-transfer-card"`) has a **Manage ownership** button
   (`data-testid="ownership-transfer-open"`) that opens the existing modal.
2. Bruce selects Selina in **Next Owner** (`data-testid="ownership-transfer-nominee"`). The list
   contains active, unrestricted Admins of this company.
3. Bruce selects **Transfer ownership**. The confirmation says Selina will become Owner and Bruce
   will become Admin. Bruce confirms this exact action with his password or linked Google identity;
   a recent sign-in does not replace this step. On confirmation, both roles change immediately in one transaction. The final
   submit retains `data-testid="ownership-transfer-complete"`.
4. The company member list and Bruce's available company access refresh to reflect the new roles.
   If the response is uncertain, retrying the same command returns its original result; it does not
   perform another transfer.

## Acceptance criteria

- Only the current Owner can start a new transfer, and the selected person must be a different,
  active, unrestricted Admin in the same company.
- The one confirmation clearly states that the selected Admin becomes Owner and the caller becomes
  Admin. Both role changes commit atomically, with exactly one active Owner before and after.
- There is no nominee consent, pending request, expiry, or recovery ceremony. The Owner's
  confirmation is the authorization for this immediate handover.
- The card is available only to the Owner. The server refuses unauthorized, stale-owner,
  masquerading, ineligible-target and malformed requests without changing either role.
- `POST /api/accounts/:accountId/ownership-transfer` accepts `{toUserId, proofId}` and returns **200**
  `{fromUserId, toUserId}` after commit. A repeated command with the same scope and payload returns
  the original result even after the caller becomes Admin; a new command requires the current Owner.
  Reusing command identity with a different scope or target returns **409**.
- The proof is bound to the Owner, native session, company and selected Admin. A proof for another
  action or target, a revoked session, role loss, cancellation or a second spend cannot transfer ownership.
- Only the **Manage ownership** entry and the existing card, open, nominee and final-submit test IDs
  remain: `ownership-transfer-card`, `ownership-transfer-open`, `ownership-transfer-nominee`, and
  `ownership-transfer-complete`.
