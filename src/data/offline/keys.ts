import { scope } from "./state";
import { originKey } from "./idb";

export function authKey(): string {
  return `auth:${originKey()}`;
}

/** Build a user-scoped cache key. Cleanup passes the scope it captured before the boundary advance
 * instead of rebuilding the same strings inline. */
export function scopedKey(kind: "accounts" | "slice", suffix = "", forScope = scope): string {
  if (!forScope) throw new Error("Offline cache scope is unavailable until a user has been verified.");
  return `${kind}:${forScope.origin}:${forScope.userId}${suffix}`;
}
