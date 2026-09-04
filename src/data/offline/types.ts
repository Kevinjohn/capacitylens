import type { AuthMode, AuthUser } from "../../auth/authContext";
import type { Role } from "@capacitylens/shared/account/types";

export interface CachedRecord<T> {
  key: string;
  savedAt: number;
  value: T;
}

export interface EncryptedRecord {
  key: string;
  savedAt: number;
  version: 1;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

export interface OfflineAuthSnapshot {
  authMode: AuthMode;
  user: AuthUser;
  canCreateAccount: boolean;
  multiAccount: boolean;
}

export interface OfflineAccountSummary {
  id: string;
  name: string;
  role: Role;
}

export interface OfflineState {
  readOnly: boolean;
  lastUpdated: number | null;
  cacheWriteFailed: boolean;
}

export type OfflineReadOwner = "identity" | "accounts" | "tenant" | "cleanup";

export interface WriteBoundary {
  generation: number;
  token: string | null;
}

export type OfflineCacheWriteResult =
  { status: "written" } | { status: "skipped"; reason: "disabled" | "unscoped" | "unchanged" };
