import type { AppData } from "@capacitylens/shared/types/entities";
import type { OfflineState, OfflineReadOwner, OfflineCacheWriteResult } from "./types";
import {
  CACHED_SLICE_KEYS,
  SLICE_REWRITE_INTERVAL_MS,
  OFFLINE_PREF_KEY,
  OFFLINE_WRITE_BOUNDARY_STORAGE_KEY,
} from "./constants";

export let scope: { origin: string; userId: string } | null = null;
let state: OfflineState = {
  readOnly: false,
  lastUpdated: null,
  cacheWriteFailed: false,
};
let offlineReadOwner: OfflineReadOwner | null = null;
// Monotonic in-memory tag for role/data projections resolved before an offline episode. It advances
// only when entering offline read mode; clearing the marker retains the new tag so pre-offline
// authority cannot become current again while live data and membership are being revalidated.
let offlineEpisode = 0;
// Cleanup advances this before touching IndexedDB. The durable companion token closes the same
// race across tabs, whose JavaScript modules necessarily have independent counters.
export let cacheGeneration = 0;
const listeners = new Set<() => void>();
const preferenceListeners = new Set<() => void>();
export const recentSliceWrites = new WeakMap<IDBFactory, Map<string, { signature: string; writtenAt: number }>>();
export const pendingWrites = new Map<string, Promise<void>>();

function sliceSignature(data: AppData): string {
  // Server revisions are the persistence change marker. This signature is much smaller to build
  // than serialising the whole tenant and is exact under the server-owned updatedAt contract.
  return CACHED_SLICE_KEYS.map(
    (table) => `${table}:${data[table].map((row) => `${row.id}@${row.updatedAt}`).join(",")}`,
  ).join("|");
}

export function publishPreference(): void {
  for (const listener of preferenceListeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === OFFLINE_PREF_KEY) {
      if (event.newValue !== "on") resetOfflineState();
      publishPreference();
      return;
    }
    if (event.key === OFFLINE_WRITE_BOUNDARY_STORAGE_KEY) {
      // Sign-out/device cleanup in another tab owns the new boundary. Drop all page-local claims
      // immediately; the durable token independently rejects writes that began before the sweep.
      cacheGeneration += 1;
      if (typeof indexedDB !== "undefined") recentSliceWrites.get(indexedDB)?.clear();
      resetOfflineState();
    }
  });
}

/** Is read-only offline access enabled on this device? Preference failures fail closed. */
export function offlineReadEnabled(): boolean {
  try {
    return localStorage.getItem(OFFLINE_PREF_KEY) === "on";
  } catch (error) {
    console.warn("offlineCache: the offline preference could not be read; disabling offline access", error);
    return false;
  }
}

export function subscribeOfflinePreference(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => preferenceListeners.delete(listener);
}

/** Decline an unchanged tenant-slice rewrite. Encryption dominates the cost of a cache write and
 * live refreshes re-deliver identical data, so a signature match inside the interval skips. */
export function sliceRewriteGate(key: string, data: AppData, now: number): OfflineCacheWriteResult | (() => void) {
  const signature = sliceSignature(data);
  const factory = typeof indexedDB === "undefined" ? null : indexedDB;
  let recent = factory ? recentSliceWrites.get(factory) : undefined;
  if (factory && !recent) {
    recent = new Map();
    recentSliceWrites.set(factory, recent);
  }
  const prior = recent?.get(key);
  if (prior?.signature === signature && now - prior.writtenAt < SLICE_REWRITE_INTERVAL_MS) {
    return { status: "skipped", reason: "unchanged" };
  }
  return () => recent?.set(key, { signature, writtenAt: now });
}

/**
 * Publish which boundary established the current offline claim. Identity/account-list refreshes
 * cannot clear a tenant-slice claim; only a successful tenant reload or cleanup has that authority.
 */
export function setOfflineReadState(
  owner: OfflineReadOwner,
  readOnly: boolean,
  lastUpdated: number | null = null,
): void {
  if (readOnly && offlineReadOwner === "tenant" && owner !== "tenant") return;
  if (!readOnly && offlineReadOwner === "tenant" && owner !== "tenant" && owner !== "cleanup") return;
  if (state.readOnly === readOnly && state.lastUpdated === lastUpdated && (!readOnly || offlineReadOwner === owner)) {
    return;
  }
  if (readOnly && !state.readOnly) offlineEpisode += 1;
  offlineReadOwner = readOnly ? owner : null;
  state = { ...state, readOnly, lastUpdated };
  for (const listener of listeners) listener();
}

export function setOfflineCacheWriteFailed(cacheWriteFailed: boolean): void {
  if (state.cacheWriteFailed === cacheWriteFailed) return;
  state = { ...state, cacheWriteFailed };
  for (const listener of listeners) listener();
}

/** Drop every page-local claim on the cache: the verified-user scope, the write-failure flag and
 * any offline read state. Cleanup and cross-tab boundary changes all end here. */
export function resetOfflineState(): void {
  scope = null;
  setOfflineCacheWriteFailed(false);
  setOfflineReadState("cleanup", false);
}

/** Current offline episode tag; reactive consumers read it after their offline-state subscription. */
export function offlineStateEpisode(): number {
  return offlineEpisode;
}

export function offlineStateSnapshot(): OfflineState {
  return state;
}

export function subscribeOfflineState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setOfflineScope(value: typeof scope): void {
  scope = value;
}

export function advanceCacheGeneration(): void {
  cacheGeneration += 1;
}
