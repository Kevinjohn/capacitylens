import { scope } from "./state";
import { readOriginKey } from "./idb";

/** Builds the origin-scoped key for the cached auth snapshot. */
export function buildAuthKey(): string {
  return `auth:${readOriginKey()}`;
}

/** Builds a user-scoped key from the scope captured before cleanup advances the write boundary. */
export function buildScopedKey(kind: "accounts" | "slice", suffix = "", forScope = scope): string {
  if (!forScope) throw new Error("Offline cache scope is unavailable until a user has been verified.");
  return `${kind}:${forScope.origin}:${forScope.userId}${suffix}`;
}
