import type { AccountMode, AuthUser } from "@/auth/authContext";
import type { Role } from "@capacitylens/shared/account/types";

/** A decoded offline record with its cache key and save time. */
export interface CachedRecord<T> {
  key: string;
  savedAt: number;
  value: T;
}

/** Stored AES-GCM payload and metadata for an offline cache record. */
export interface EncryptedRecord {
  key: string;
  savedAt: number;
  version: 2;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

/** Verified auth and account-creation capabilities available to offline UI. */
export interface OfflineAuthSnapshot {
  authMode: AccountMode;
  user: AuthUser;
  canCreateAccount: boolean;
  multiAccount: boolean;
}

/** Account identity and role included in the offline picker snapshot. */
export interface OfflineAccountSummary {
  id: string;
  name: string;
  role: Role;
}

/** Read-only cache status exposed to offline-aware components. */
export interface OfflineState {
  readOnly: boolean;
  lastUpdated: number | null;
  cacheWriteFailed: boolean;
}

/** Part of the application currently controlling offline-read state. */
export type OfflineReadOwner = "identity" | "accounts" | "tenant" | "cleanup";

/** Generation and token that prevent stale writes crossing cache cleanup. */
export interface WriteBoundary {
  generation: number;
  token: string | null;
}

/** Outcome of attempting to persist a record in the offline cache. */
export type OfflineCacheWriteResult =
  { kind: "written" } | { kind: "skipped"; reason: "disabled" | "unscoped" | "unchanged" | "discarded" | "masquerade" };
