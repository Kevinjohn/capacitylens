import { scope } from "./state";
import { readOriginKey } from "./idb";

/** Builds the origin-scoped key for the cached auth snapshot. */
export function buildAuthKey(): string {
  return `auth:${readOriginKey()}`;
}

/** Build a user-scoped cache key. Cleanup passes the scope it captured before the boundary advance
 * instead of rebuilding the same strings inline. */
export function buildScopedKey(kind: "accounts" | "slice", suffix = "", forScope = scope): string {
  if (!forScope) throw new Error("Offline cache scope is unavailable until a user has been verified.");
  return `${kind}:${forScope.origin}:${forScope.userId}${suffix}`;
}
