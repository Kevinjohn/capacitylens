import { KNOWN_KEYS, migrateWithRepairBase } from "@capacitylens/shared/data/migrate";
import type { AppData } from "@capacitylens/shared/types/entities";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import {
  cacheAccountSlice,
  readCachedAccountSlice,
  readCachedAuthSnapshot,
  setOfflineReadState,
} from "../offlineCache";
import { LoadError } from "../PersistenceAdapter";
import { API_BULK_TIMEOUT_MS } from "../requestTimeout";
import { diffOps } from "../syncOps";
import { isRecord, validateAccountSliceWithRepairBase } from "../validateAccountSlice";
import { referencedMissingTables } from "./fkGraph";
import { seedSnapshot } from "./snapshot";
import type { SyncState } from "./state";

// P3.4: every request carries credentials so an auth-enabled server (CAPACITYLENS_AUTH ≠ off)
// sees the Better Auth session cookie. With auth off (the default) and same-origin
// requests there are no cookies to send — a verified no-op (the db-backed e2e project
// runs unchanged); the server pairs reflected CORS origins with Allow-Credentials.
//
// @param accountId  When PRESENT (P1.13), load ONLY that account's scoped slice via
//   `GET /api/state?accountId=…`. This is the per-account hydration path: the picker chose a tenant
//   and we load just its data. When ABSENT, fall back to the no-arg whole read — used in OFF/demo
//   (still a whole tree) and the pre-pick bootstrap before any account is active (in auth-on the
//   server now 400s a no-arg read, which surfaces as a LoadError → connection screen, which is
//   correct: there's nothing to show until a tenant is picked and re-loaded with an id).
//
// EITHER WAY `lastSynced` is set to EXACTLY the returned body — this is the diff SNAPSHOT every save
// is computed against, so it MUST equal the slice we just loaded. The persist switch orchestrator
// (persist.ts) relies on this: re-seeding the snapshot to the new account in the SAME call as the
// load is what keeps snapshot and `data` on the same tenant. If they ever desync (snapshot=A,
// data=B) the next save would emit DELETEs for A + PUTs for B → cross-account data loss.
export async function loadAll(
  state: SyncState,
  saveAll: (next: AppData) => Promise<void>,
  accountId?: string,
): Promise<AppData> {
  const myGen = ++state.loadGen;
  try {
    const url =
      accountId !== undefined
        ? `${state.baseUrl}/api/state?accountId=${encodeURIComponent(accountId)}`
        : `${state.baseUrl}/api/state`;
    // Whole-slice hydration: the BULK tier, not the interactive 15s — a large tenant's full read
    // can legitimately outrun the interactive bound against a healthy-but-slow server.
    const res = await state.request(url, { credentials: "include" }, API_BULK_TIMEOUT_MS);
    // The no-arg whole read is CLOSED in auth-on (P1.13): the server 400s it (tenant isolation —
    // a logged-in user must hydrate PER ACCOUNT via ?accountId=). Treat that 400 on the NO-ARG read
    // as "nothing to hydrate yet" — return EMPTY (snapshot empty) so bootstrap shows the picker
    // rather than a connection-error dead end. The picker lists the login's accounts from
    // GET /api/accounts (useAccountSummaries); picking one hydrates its slice via loadAll(accountId).
    // OFF keeps the no-arg whole read (200), so this branch never fires there. A 400 on a SCOPED
    // read (accountId present) is a real error and still throws below.
    if (accountId === undefined && res.status === 400) {
      const empty = emptyAppData();
      if (myGen === state.loadGen) {
        seedSnapshot(state, empty);
        setOfflineReadState("tenant", false);
      }
      return empty;
    }
    if (!res.ok) throw new Error(`Failed to load state (${res.status})`);
    // An HTML body — the SPA-fallback index.html or a proxy error page, a REACHABLE case now an
    // empty-env server-default build can hit a backend-less same-origin host — starts with '<', so
    // native res.json() runs JSON.parse and REJECTS with a SyntaxError. That rejection is caught
    // below and mapped to LoadError('unavailable') → the connection-error screen; it does NOT reach
    // migrate(). So migrate() only ever sees a body that already parsed as JSON.
    const json: unknown = await res.json();
    // DEPLOYMENT CONTRACT (rolling deploy — new client, older server): a version-skewed OLDER
    // server may OMIT a table key this newer client already knows about. A MISSING key is
    // TOLERATED on BOTH read paths — the unscoped migrate()/normalize hydrates it empty, and the
    // scoped path pre-fills it empty below so validateAccountSlice hydrates it empty too — so a
    // new-client/old-server skew is not a total outage on every deploy, and an account switch or
    // scoped load during a version-skew window no longer throws "incomplete state payload". But a
    // key that is PRESENT and NOT an array is a corrupt/incomplete payload masquerading as empty
    // data, so it stays a HARD failure on both paths. (Same principle as the import path's
    // hasNonArrayKnownTable: repair within a record, reject a structurally broken one — never coerce
    // a broken table to [] and report it as success.) The cross-tenant (wrong accountId) checks
    // inside validateAccountSlice keep their FULL strictness regardless.
    if (!isRecord(json)) {
      throw new Error("The server returned an invalid state payload.");
    }
    const record = json;
    if (KNOWN_KEYS.some((key) => key in record && !Array.isArray(record[key]))) {
      throw new Error("The server returned an invalid state payload.");
    }
    // A missing known key is tolerated (hydrated empty) but DIAGNOSABLE: warn ONCE per load, naming
    // every omitted table. A rolling-deploy skew (new client, older server) is the expected benign
    // cause; the SAME warning against a same-version server is the signal that a proxy or server bug
    // silently dropped a table — without this it would load as "empty" invisibly and be undiagnosable.
    const missingKeys = KNOWN_KEYS.filter((key) => !(key in record));
    const referencedMissing = referencedMissingTables(record, missingKeys);
    if (referencedMissing.length > 0) {
      throw new Error(
        `The server returned an incomplete state payload: omitted referenced table(s) [${referencedMissing.join(
          ", ",
        )}].`,
      );
    }
    if (missingKeys.length > 0) {
      console.warn(
        `ServerSyncAdapter: the server state payload omitted known table(s) [${missingKeys.join(", ")}]; ` +
          "hydrating them empty. Expected during a rolling deploy (new client, older server); if the " +
          "server is the SAME version, a proxy or server bug dropped the table(s).",
      );
    }
    // Scoped path: pre-fill any missing known table as an empty array so validateAccountSlice
    // hydrates it empty instead of hard-failing "incomplete" (its per-key Array.isArray check treats
    // an ABSENT key as a reject). We do this in the scoped BRANCH rather than in validateAccountSlice
    // itself because other callers of that validator (fetchInactiveSlice's backup/export path) rely
    // on its full-completeness contract. Present-but-non-array was already rejected above; the
    // accountId cross-tenant checks still run at full strictness on the real rows.
    const scopedInput =
      missingKeys.length > 0
        ? {
            ...record,
            ...Object.fromEntries(missingKeys.map((key) => [key, [] as unknown[]])),
          }
        : record;
    const migrated =
      accountId === undefined
        ? migrateWithRepairBase(json)
        : validateAccountSliceWithRepairBase(scopedInput, accountId);
    if (!migrated) throw new Error("The server returned a cross-tenant or incomplete state payload.");
    const { data, repairBase } = migrated;
    // Re-seed the diff snapshot to the SLICE we just loaded (atomic with the load — see the
    // method doc). A switch orchestrator calling loadAll(newId) gets lastSynced === the new
    // account's slice, so the immediately-following saveAll diffs new-vs-new = ZERO ops, never
    // cross-account deletes. Generation-guarded: a SUPERSEDED load (a newer loadAll started
    // while this fetch was in flight) must not seed — its slice is discarded by persist.ts's
    // token guard, and seeding here anyway would desync snapshot from data (see loadGen).
    if (myGen === state.loadGen) {
      // Seed the state the server ACTUALLY returned, then attempt to durably converge any
      // Internal-client synthesis/restamp/duplicate fold before acknowledging and exposing the
      // repaired slice. The current server owns its protected Internal row and may reject a
      // legacy/corrupt repair it cannot safely apply; that rejects hydration rather than masking
      // the incompatible durable state.
      // Bootstrap attaches its save subscription only after loadAll returns, so deferring this
      // write would leave the repair permanently memory-only. saveAll preserves the adapter's
      // ordinary parent-before-child/upserts-before-deletes ordering and advances lastSynced only
      // after a confirmed receipt. A failed repair rejects hydration rather than presenting data
      // whose required parent rows do not exist durably.
      seedSnapshot(state, repairBase, accountId);
      // Avoid joining an unrelated in-flight save when migration was identity-preserving. Besides
      // being unnecessary, awaiting that request here would make a concurrent reload wait on a
      // batch whose own race coordinator may be waiting for the reload to finish.
      if (diffOps(repairBase, data).length > 0) await saveAll(data);
      setOfflineReadState("tenant", false);
      if (accountId !== undefined && missingKeys.length === 0) {
        void cacheAccountSlice(accountId, data).catch((error) =>
          console.warn("ServerSyncAdapter: the offline account snapshot could not be updated", error),
        );
      }
    }
    return data;
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
    // unreadable server payload are ALL remote conditions: the user recovers by
    // RETRYING, never by clearing local storage (the corrupt-data reset path,
    // which can't recover a server-backed app). Flag as 'unavailable' so bootstrap
    // routes to the connection-error screen, not StorageRecovery.
    throw new LoadError("unavailable", e instanceof Error ? e.message : "Failed to load state from server.", {
      cause: e,
    });
  }
}

/**
 * loadAll's offline tail, reached ONLY after the request proved the service unreachable (a fetch
 * TypeError). Returns the snapshot to hydrate from, or `null` when nothing usable is cached and
 * the caller must surface the LoadError.
 *
 * Both arms are generation-guarded on `myGen`: a superseded load may still READ the cache, but
 * must not seed the adapter snapshot or flip the app into offline-read mode behind a newer load.
 * A cache read that throws is a degraded local store, never a reason to hide the real remote
 * failure — it is warned about and falls through to the caller's LoadError.
 */
export async function hydrateFromOfflineCache(
  state: SyncState,
  accountId: string | undefined,
  myGen: number,
): Promise<AppData | null> {
  if (accountId === undefined) {
    try {
      const cachedIdentity = await readCachedAuthSnapshot({
        acceptEffects: () => myGen === state.loadGen,
      });
      if (cachedIdentity) {
        const empty = emptyAppData();
        if (myGen === state.loadGen) seedSnapshot(state, empty);
        if (myGen === state.loadGen) setOfflineReadState("tenant", true, cachedIdentity.savedAt);
        return empty;
      }
    } catch (cacheError) {
      console.warn("ServerSyncAdapter: the offline identity snapshot could not be read", cacheError);
    }
    return null;
  }
  try {
    const cached = await readCachedAccountSlice(accountId);
    if (cached) {
      if (myGen === state.loadGen) seedSnapshot(state, cached.value, accountId);
      if (myGen === state.loadGen) setOfflineReadState("tenant", true, cached.savedAt);
      return cached.value;
    }
  } catch (cacheError) {
    console.warn("ServerSyncAdapter: the offline account snapshot could not be read", cacheError);
  }
  return null;
}

export async function hasExisting(state: SyncState): Promise<boolean> {
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
