export interface Entitlements {
  unlimited: true
}

/** CapacityLens currently applies no per-company product limits. */
export function resolveEntitlements(accountId: string): Entitlements {
  void accountId
  return { unlimited: true }
}
