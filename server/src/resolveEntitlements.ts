/** The current entitlement contract for an account. */
export interface Entitlements {
  unlimited: true;
}

/** Returns the current unlimited entitlements for an account. */
export function resolveEntitlements(accountId: string): Entitlements {
  void accountId;
  return { unlimited: true };
}
