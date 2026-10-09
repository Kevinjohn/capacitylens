import { KNOWN_KEYS, migrateWithRepairBase } from "@capacitylens/shared/data/migrate";
import type { MigrationWithRepairBase } from "@capacitylens/shared/data/migrate";
import type { AppData } from "@capacitylens/shared/types/entities";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import {
  cacheAccountSlice,
  isOfflineReadEnabled,
  readCachedAccountSlice,
  readCachedAuthSnapshot,
  setOfflineReadState,
} from "@/data/offlineCache";
import { LoadError } from "@/data/PersistenceAdapter";
import { API_BULK_TIMEOUT_MS } from "@/data/requestTimeout";
import { diffOps } from "@/data/syncOps";
import { parseAccountSliceWithRepairBase } from "@/data/validateAccountSlice";
import { listReferencedMissingTables } from "./fkGraph";
import { seedSnapshot } from "./snapshot";
import type { SyncState } from "./SyncState";
import { isRecord } from "@capacitylens/shared/lib/isRecord";

interface LoadedState extends MigrationWithRepairBase {
  readonly missingKeys: readonly string[];
}

interface LiveLoadEffects {
  readonly state: SyncState;
  readonly saveAll: (next: AppData) => Promise<void>;
  readonly loaded: LoadedState;
  readonly myGen: number;
  readonly accountId: string | undefined;
}

interface CachedLoadEffects {
  readonly state: SyncState;
  readonly data: AppData;
  readonly savedAt: number;
  readonly myGen: number;
  readonly accountId?: string;
}

function parseLoadedState(json: unknown, accountId: string | undefined): LoadedState {
  if (!isRecord(json)) throw new Error("The server returned an invalid state payload.");
  const record = json;
  if (KNOWN_KEYS.some((key) => key in record && !Array.isArray(record[key]))) {
    throw new Error("The server returned an invalid state payload.");
  }
  const missingKeys = KNOWN_KEYS.filter((key) => !(key in record));
  const referencedMissing = listReferencedMissingTables(record, missingKeys);
  if (referencedMissing.length > 0) {
    throw new Error(
      `The server returned an incomplete state payload: omitted referenced table(s) [${referencedMissing.join(", ")}].`,
    );
  }
  if (missingKeys.length > 0) {
    console.warn(
      `ServerSyncAdapter: the server state payload omitted known table(s) [${missingKeys.join(", ")}]; ` +
        "hydrating them empty. Expected during a rolling deploy (new client, older server); if the " +
        "server is the SAME version, a proxy or server bug dropped the table(s).",
    );
  }
  const scopedInput =
    missingKeys.length > 0
      ? { ...record, ...Object.fromEntries(missingKeys.map((key) => [key, [] as unknown[]])) }
      : record;
  const migrated =
    accountId === undefined ? migrateWithRepairBase(json) : parseAccountSliceWithRepairBase(scopedInput, accountId);
  if (!migrated) throw new Error("The server returned a cross-tenant or incomplete state payload.");
  return { ...migrated, missingKeys };
}

async function applyLiveLoadEffects({ state, saveAll, loaded, myGen, accountId }: LiveLoadEffects): Promise<void> {
  // Keep the generation guard first, then seed the repairBase snapshot and await its durable repair
  // before exposing the load as online. Cache only a complete scoped payload after that sequence;
  // otherwise a superseded or desynchronised load could publish cross-account state.
  if (myGen !== state.loadGen) return;
  seedSnapshot(state, loaded.repairBase, accountId);
  if (diffOps(loaded.repairBase, loaded.data).length > 0) {
    await saveAll(loaded.data);
    // A newer load may have installed a cached, read-only slice while the repair was in flight.
    if (myGen !== state.loadGen) return;
  }
  setOfflineReadState({ owner: "tenant", readOnly: false });
  if (accountId !== undefined && loaded.missingKeys.length === 0) {
    void cacheAccountSlice(accountId, loaded.data).catch((error) =>
      console.warn("ServerSyncAdapter: the offline account snapshot could not be updated", error),
    );
  }
}

function applyCachedLoadEffects({ state, data, savedAt, myGen, accountId }: CachedLoadEffects): void {
  if (myGen === state.loadGen) seedSnapshot(state, data, accountId);
  if (myGen === state.loadGen) setOfflineReadState({ owner: "tenant", readOnly: true, lastUpdated: savedAt });
}

interface LoadRequest {
  readonly accountId: string | undefined;
  readonly myGen: number;
}

interface LoadOptions {
  readonly accountId: string | undefined;
  readonly skipRemoteRead?: boolean;
}

/** Load an unscoped dataset or account slice, or seed an empty snapshot for live-auth pre-pick startup.
 * Every accepted result re-seeds the diff snapshot to the returned data so subsequent saves cannot
 * diff across accounts. Superseded loads do not change the snapshot. */
export async function loadAll(
  state: SyncState,
  saveAll: (next: AppData) => Promise<void>,
  options: LoadOptions = { accountId: undefined },
): Promise<AppData> {
  const myGen = ++state.loadGen;
  if (options.skipRemoteRead) {
    const empty = emptyAppData();
    if (myGen === state.loadGen) {
      seedSnapshot(state, empty, options.accountId);
      setOfflineReadState({ owner: "tenant", readOnly: false });
    }
    return empty;
  }
  return loadRemoteSlice(state, saveAll, { accountId: options.accountId, myGen });
}

async function loadRemoteSlice(
  state: SyncState,
  saveAll: (next: AppData) => Promise<void>,
  { accountId, myGen }: LoadRequest,
): Promise<AppData> {
  try {
    // Every request carries credentials so auth-enabled servers see the Better Auth session cookie.
    // With auth off, same-origin requests send no cookies; the server pairs reflected CORS origins
    // with Allow-Credentials.
    const url =
      accountId !== undefined
        ? `${state.baseUrl}/api/state?accountId=${encodeURIComponent(accountId)}`
        : `${state.baseUrl}/api/state`;
    // Whole-slice hydration: the bulk tier, not the interactive 15s, a large tenant's full read
    // can legitimately outrun the interactive bound against a healthy-but-slow server.
    const res = await state.request(url, { credentials: "include" }, API_BULK_TIMEOUT_MS);
    // The no-arg whole read is closed in auth-on: the server 400s it (tenant isolation,
    // a logged-in user must hydrate per account via ?accountId=). Treat that 400 on the no-arg read
    // as "nothing to hydrate yet", return empty (snapshot empty) so bootstrap shows the picker
    // rather than a connection-error dead end. The picker lists the login's accounts from
    // GET /api/accounts (useAccountSummaries); picking one hydrates its slice via loadAll(accountId).
    // Off keeps the no-arg whole read (200), so this branch never fires there. A 400 on a scoped
    // read (accountId present) is a real error and still throws below.
    if (accountId === undefined && res.status === 400) {
      const empty = emptyAppData();
      if (myGen === state.loadGen) {
        seedSnapshot(state, empty);
        setOfflineReadState({ owner: "tenant", readOnly: false });
      }
      return empty;
    }
    if (!res.ok) throw new Error(`Failed to load state (${res.status})`);
    // An HTML body (the SPA-fallback index.html or a proxy error page, a reachable case now an
    // empty-env server-default build can hit a backend-less same-origin host) starts with '<', so
    // native res.json() runs JSON.parse and rejects with a SyntaxError. That rejection is caught
    // below and mapped to LoadError('unavailable') → the connection-error screen; it does not reach
    // migrate(). So migrate() only ever sees a body that already parsed as JSON.
    const json: unknown = await res.json();
    // Deployment contract (rolling deploy, new client, older server): a version-skewed older
    // server may omit a table key this newer client already knows about. A missing key is
    // tolerated on both read paths (the unscoped migrate()/normalize hydrates it empty, and the
    // scoped path pre-fills it empty below so parseAccountSlice hydrates it empty too), so a
    // new-client/old-server skew is not a total outage on every deploy, and an account switch or
    // scoped load during a version-skew window no longer throws "incomplete state payload". But a
    // key that is present and not an array is a corrupt/incomplete payload masquerading as empty
    // data, so it stays a hard failure on both paths. (Same principle as the import path's
    // hasNonArrayKnownTable: repair within a record, reject a structurally broken one, never coerce
    // a broken table to [] and report it as success.) The cross-tenant (wrong accountId) checks
    // inside parseAccountSlice keep their full strictness regardless.
    // A missing known key is tolerated (hydrated empty) but diagnosable: warn once per load, naming
    // every omitted table. A rolling-deploy skew (new client, older server) is the expected benign
    // cause; the same warning against a same-version server is the signal that a proxy or server bug
    // silently dropped a table, without this it would load as "empty" invisibly and be undiagnosable.
    // Scoped path: pre-fill any missing known table as an empty array so parseAccountSlice
    // hydrates it empty instead of hard-failing "incomplete" (its per-key Array.isArray check treats
    // an absent key as a reject). We do this in the scoped branch rather than in parseAccountSlice
    // itself because other callers of that validator (fetchInactiveSlice's backup/export path) rely
    // on its full-completeness contract. Present-but-non-array was already rejected above; the
    // accountId cross-tenant checks still run at full strictness on the real rows.
    const loaded = parseLoadedState(json, accountId);
    // Re-seed the diff snapshot to the slice we just loaded (atomic with the load, see the
    // method doc). A switch orchestrator calling loadAll(newId) gets lastSynced === the new
    // account's slice, so the immediately-following saveAll diffs new-vs-new = zero ops, never
    // cross-account deletes. Generation-guarded: a superseded load (a newer loadAll started
    // while this fetch was in flight) must not seed. Its slice is discarded by persist.ts's
    // token guard, and seeding here anyway would desync snapshot from data (see loadGen).
    await applyLiveLoadEffects({ state, saveAll, loaded, myGen, accountId });
    return loaded.data;
  } catch (e) {
    // Only an actual fetch/network rejection proves the service is unreachable enough to use a
    // stale read-only snapshot. A reachable 5xx and our own Abort/Timeout deadline are server
    // failures: route them to the retry screen instead of presenting old data as ordinary offline
    // mode. Browser fetch reports network/DNS/TLS failures as TypeError.
    const offlineEligible = e instanceof TypeError;
    if (offlineEligible) {
      const cached = await hydrateFromOfflineCache(state, accountId, myGen);
      if (cached !== null) return cached;
    }
    // A rejected fetch (server down / network error), a non-OK status, or an
    // unreadable server payload are all remote conditions: the user recovers by
    // retrying, never by clearing local storage (the corrupt-data reset path,
    // which can't recover a server-backed app). Flag as 'unavailable' so bootstrap
    // routes to the connection-error screen, not StorageRecovery.
    throw new LoadError("unavailable", e instanceof Error ? e.message : "Failed to load state from server.", {
      cause: e,
    });
  }
}

/**
 * loadAll's offline tail, reached only after the request proved the service unreachable (a fetch
 * TypeError). Returns the snapshot to hydrate from, or `null` when nothing usable is cached and
 * the caller must surface the LoadError.
 *
 * Both arms are generation-guarded on `myGen`: a superseded load may still read the cache, but
 * must not seed the adapter snapshot or flip the app into offline-read mode behind a newer load.
 * A cache read that throws is a degraded local store, never a reason to hide the real remote
 * failure. It is warned about and falls through to the caller's LoadError.
 */
export async function hydrateFromOfflineCache(
  state: SyncState,
  accountId: string | undefined,
  myGen: number,
): Promise<AppData | null> {
  if (accountId === undefined) {
    try {
      const cachedIdentity = await readCachedAuthSnapshot({
        acceptEffects: () => myGen === state.loadGen && isOfflineReadEnabled(),
      });
      if (!isOfflineReadEnabled()) return null;
      if (cachedIdentity) {
        const empty = emptyAppData();
        applyCachedLoadEffects({ state, data: empty, savedAt: cachedIdentity.savedAt, myGen });
        return empty;
      }
    } catch (cacheError) {
      console.warn("ServerSyncAdapter: the offline identity snapshot could not be read", cacheError);
    }
    return null;
  }
  try {
    const cached = await readCachedAccountSlice(accountId);
    if (!isOfflineReadEnabled()) return null;
    if (cached) {
      applyCachedLoadEffects({ state, data: cached.value, savedAt: cached.savedAt, myGen, accountId });
      return cached.value;
    }
  } catch (cacheError) {
    console.warn("ServerSyncAdapter: the offline account snapshot could not be read", cacheError);
  }
  return null;
}

export async function readHasExistingData(state: SyncState): Promise<boolean> {
  const res = await state.request(`${state.baseUrl}/api/meta`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to read meta (${res.status})`);
  const json: unknown = await res.json();
  if (!isRecord(json) || typeof json.hasData !== "boolean") {
    throw new Error("The server returned an invalid meta payload.");
  }
  return json.hasData;
}
