// THE ENTITLEMENTS SWAP POINT (P1.16) — the control-plane seam, mirroring tenantStore.ts's
// documented-swap-point style. It answers "what is this account allowed to do?" in ONE place.
//
// TODAY: every account is UNLIMITED. There is NO billing, NO plan/tier field, NO quota, and NO
// enforcement anywhere — this module is PARKED-but-SHAPED: it establishes the call site and the
// return shape so a future plan/quota lookup (Stripe entitlements, a plans table, a per-account
// flag) swaps in BEHIND entitlementsFor ONLY, with no change to any caller.
//
// INERT BY DESIGN: nothing imports this yet (only its unit test references it). It is deliberately
// NOT wired into any route, write path, or limit check. Wiring + enforcement is a later task; the
// secure/correct default until then is "unlimited" (we never want a half-built quota silently
// blocking a real user). When enforcement lands, this is the single function to grow.

/**
 * What an account is entitled to. Minimal on purpose — the architecture's default is
 * "default-unlimited", so the only fact today is `unlimited: true`.
 *
 * Deliberately carries NO `maxResources` / `plan` / `billing` fields: adding them now would invite
 * dead, untested limit code. A future tier/quota model extends THIS interface (and the lookup in
 * {@link entitlementsFor}) when enforcement is actually wired.
 */
export interface Entitlements {
  unlimited: true
}

/**
 * Resolve the {@link Entitlements} for one account — THE entitlements swap point.
 *
 * Today returns `{ unlimited: true }` for every account; `accountId` is in the signature for the
 * future per-account lookup (plan/quota by account) and is intentionally unused now. This function
 * is INERT: it is imported by nothing on a route/write path, so it enforces nothing — it only fixes
 * the call shape a later plan/quota backend swaps in behind.
 *
 * @param accountId  The account to resolve entitlements for (unused today; reserved for the future
 *   per-account lookup).
 * @returns The account's entitlements — always `{ unlimited: true }` until a plan model is wired.
 */
export function entitlementsFor(accountId: string): Entitlements {
  void accountId // reserved for the future per-account lookup (the documented swap point); unused today
  return { unlimited: true }
}
