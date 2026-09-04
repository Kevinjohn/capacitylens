import type { AppData } from "@capacitylens/shared/types/entities";
import { validateAccountSlice } from "./validateAccountSlice";
import { setOfflineScope, sliceRewriteGate } from "./offline/state";
import { originKey } from "./offline/idb";
import { authKey, scopedKey } from "./offline/keys";
import { cachedRecord, validateAuthSnapshot, validateAccountSummaries } from "./offline/records";
import type {
  CachedRecord,
  OfflineAuthSnapshot,
  OfflineAccountSummary,
  OfflineCacheWriteResult,
} from "./offline/types";

export { OFFLINE_WRITE_BOUNDARY_STORAGE_KEY } from "./offline/constants";
export type { OfflineAuthSnapshot } from "./offline/types";
export {
  offlineReadEnabled,
  subscribeOfflinePreference,
  setOfflineReadState,
  offlineStateEpisode,
  offlineStateSnapshot,
  subscribeOfflineState,
} from "./offline/state";
export { offlineShellAvailable, revalidateOfflineShell, setOfflineReadEnabled } from "./offline/shell";

const authSnapshotCache = cachedRecord<OfflineAuthSnapshot>(authKey, validateAuthSnapshot, {
  readNeedsScope: false,
});
const accountSummariesCache = cachedRecord<OfflineAccountSummary[]>(
  () => scopedKey("accounts"),
  validateAccountSummaries,
);
const accountSliceCache = cachedRecord<AppData, [accountId: string]>(
  (accountId) => scopedKey("slice", `:${accountId}`),
  (value, accountId) => validateAccountSlice(value, accountId),
  { gate: sliceRewriteGate },
);

/** Persist the last verified identity and make it the cache scope for this page. */
export async function cacheAuthSnapshot(snapshot: OfflineAuthSnapshot): Promise<OfflineCacheWriteResult> {
  setOfflineScope({ origin: originKey(), userId: snapshot.user.id });
  return authSnapshotCache.write(snapshot);
}

/** Restore the last verified identity for an offline boot. Never fabricates a session. */
export async function readCachedAuthSnapshot(
  opts: { acceptEffects?: () => boolean } = {},
): Promise<CachedRecord<OfflineAuthSnapshot> | null> {
  const record = await authSnapshotCache.read();
  if (record && (opts.acceptEffects?.() ?? true)) {
    // A cache miss is evidence only about durable cache state. It must not revoke a scope that a
    // concurrent successful live /me already established through cacheAuthSnapshot; explicit
    // sign-out/device cleanup owns scope removal. A cached hit may still establish cold-boot scope.
    setOfflineScope({ origin: originKey(), userId: record.value.user.id });
  }
  return record;
}

export async function cacheAccountSummaries(summaries: OfflineAccountSummary[]): Promise<OfflineCacheWriteResult> {
  return accountSummariesCache.write(summaries);
}

export async function readCachedAccountSummaries(): Promise<CachedRecord<OfflineAccountSummary[]> | null> {
  return accountSummariesCache.read();
}

export async function cacheAccountSlice(accountId: string, data: AppData): Promise<OfflineCacheWriteResult> {
  return accountSliceCache.write(data, accountId);
}

export async function readCachedAccountSlice(accountId: string): Promise<CachedRecord<AppData> | null> {
  return accountSliceCache.read(accountId);
}

export { clearOfflineDataForCurrentUser, clearAllOfflineData } from "./offline/cleanup";
