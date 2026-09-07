import type { AppData } from "@capacitylens/shared/types/entities";
import { parseAccountSlice } from "./validateAccountSlice";
import { setOfflineScope, resolveSliceRewrite } from "./offline/state";
import { readOriginKey } from "./offline/idb";
import { buildAuthKey, buildScopedKey } from "./offline/keys";
import { createCachedRecord, parseAuthSnapshot, parseAccountSummaries } from "./offline/records";
import type {
  CachedRecord,
  OfflineAuthSnapshot,
  OfflineAccountSummary,
  OfflineCacheWriteResult,
} from "./offline/types";

export { OFFLINE_WRITE_BOUNDARY_STORAGE_KEY } from "./offline/constants";
export type { OfflineAuthSnapshot } from "./offline/types";
export {
  isOfflineReadEnabled,
  subscribeOfflinePreference,
  setOfflineReadState,
  readOfflineStateEpisode,
  readOfflineStateSnapshot,
  subscribeOfflineState,
} from "./offline/state";
export { isOfflineShellAvailable, revalidateOfflineShell, setOfflineReadEnabled } from "./offline/shell";

const authSnapshotCache = createCachedRecord<OfflineAuthSnapshot>(buildAuthKey, parseAuthSnapshot, {
  readNeedsScope: false,
});
const accountSummariesCache = createCachedRecord<OfflineAccountSummary[]>(
  () => buildScopedKey("accounts"),
  parseAccountSummaries,
);
const accountSliceCache = createCachedRecord<AppData, [accountId: string]>(
  (accountId) => buildScopedKey("slice", `:${accountId}`),
  (value, accountId) => parseAccountSlice(value, accountId),
  { gate: resolveSliceRewrite },
);

/** Persist the last verified identity and make it the cache scope for this page. */
export async function cacheAuthSnapshot(snapshot: OfflineAuthSnapshot): Promise<OfflineCacheWriteResult> {
  setOfflineScope({ origin: readOriginKey(), userId: snapshot.user.id });
  return authSnapshotCache.write(snapshot);
}

/** Restore the last verified identity for an offline boot. Never fabricates a session. */
export async function readCachedAuthSnapshot(
  options: { acceptEffects?: () => boolean } = {},
): Promise<CachedRecord<OfflineAuthSnapshot> | null> {
  const record = await authSnapshotCache.read();
  if (record && (options.acceptEffects?.() ?? true)) {
    // A cache miss is evidence only about durable cache state. It must not revoke a scope that a
    // concurrent successful live /me already established through cacheAuthSnapshot; explicit
    // sign-out/device cleanup owns scope removal. A cached hit may still establish cold-boot scope.
    setOfflineScope({ origin: readOriginKey(), userId: record.value.user.id });
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
