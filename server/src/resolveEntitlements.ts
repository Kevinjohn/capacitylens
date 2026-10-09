// The entitlements swap point, the control-plane seam that answers
// "what is this account allowed to do?" in one place.
//
// Today: every account is unlimited. There is no billing, no plan/tier field, no quota, and no
// enforcement anywhere, this module is parked-but-shaped: it establishes the call site and the
// return shape so a future plan/quota lookup (Stripe entitlements, a plans table, a per-account
// flag) swaps in behind entitlementsFor only, with no change to any caller.
//
// Inert by design: nothing imports this yet (only its unit test references it). It is deliberately
// not wired into any route, write path, or limit check. Wiring + enforcement is a later task; the
// secure/correct default until then is "unlimited" (we never want a half-built quota silently
// blocking a real user). When enforcement lands, this is the single function to grow.

/**
 * What an account is entitled to. Minimal on purpose. The architecture's default is
 * "default-unlimited", so the only fact today is `unlimited: true`.
 *
 * Deliberately carries no `maxResources` / `plan` / `billing` fields: adding them now would invite
 * dead, untested limit code. A future tier/quota model extends this interface (and the lookup in
 * {@link resolveEntitlements}) when enforcement is actually wired.
 */
export interface Entitlements {
  unlimited: true;
}

/**
 * Resolve the {@link Entitlements} for one account, the entitlements swap point.
 *
 * Today returns `{ unlimited: true }` for every account; `accountId` is in the signature for the
 * future per-account lookup (plan/quota by account) and is intentionally unused now. This function
 * is inert: it is imported by nothing on a route/write path, so it enforces nothing. It only fixes
 * the call shape a later plan/quota backend swaps in behind.
 *
 * @param accountId  The account to resolve entitlements for (unused today; reserved for the future
 * per-account lookup).
 * @returns The account's entitlements, always `{ unlimited: true }` until a plan model is wired.
 */
export function resolveEntitlements(accountId: string): Entitlements {
  void accountId; // reserved for the future per-account lookup (the documented swap point); unused today
  return { unlimited: true };
}
