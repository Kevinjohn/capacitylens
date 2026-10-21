import { KNOWN_KEYS, migrateWithRepairBase } from "@capacitylens/shared/data/migrate";
import type { MigrationWithRepairBase } from "@capacitylens/shared/data/migrate";
import type { AppData } from "@capacitylens/shared/types/entities";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { LoadError } from "@/data/PersistenceAdapter";
import { API_BULK_TIMEOUT_MS } from "@/data/requestTimeout";
import { diffOps } from "@/data/syncOps";
import { parseAccountSliceWithRepairBase } from "@/data/validateAccountSlice";
import { listReferencedMissingTables } from "./fkGraph";
import { seedSnapshot } from "./snapshot";
import type { SyncState } from "./SyncState";
import { isRecord } from "@capacitylens/shared/lib/isRecord";

interface LiveLoadEffects {
  readonly state: SyncState;
  readonly saveAll: (next: AppData) => Promise<void>;
  readonly loaded: MigrationWithRepairBase;
  readonly myGen: number;
  readonly accountId: string | undefined;
}

function parseLoadedState(json: unknown, accountId: string | undefined): MigrationWithRepairBase {
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
  return migrated;
}

async function applyLiveLoadEffects({ state, saveAll, loaded, myGen, accountId }: LiveLoadEffects): Promise<void> {
  // A superseded response must not replace the current account baseline.
  if (myGen !== state.loadGen) return;
  seedSnapshot(state, loaded.repairBase, accountId);
  if (diffOps(loaded.repairBase, loaded.data).length > 0) {
    await saveAll(loaded.data);
  }
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
    // Include credentials so authenticated servers receive the session cookie on same-origin
    // and permitted cross-origin requests.
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
      }
      return empty;
    }
    if (!res.ok) throw new Error(`Failed to load state (${res.status})`);
    // Treat non-JSON server responses as unavailable so recovery retries the remote read
    // instead of migrating a proxy page or clearing local data.
    const json: unknown = await res.json();
    // Missing tables may hydrate empty only when no retained row references them.
    // Present non-array tables and cross-tenant rows remain failures. Warn on omissions
    // so compatible version skew is observable; complete backup reads keep stricter validation.
    const loaded = parseLoadedState(json, accountId);
    // Pair the loaded slice with its baseline only while this generation owns hydration,
    // so a superseded response cannot make a later save diff across tenants.
    await applyLiveLoadEffects({ state, saveAll, loaded, myGen, accountId });
    return loaded.data;
  } catch (e) {
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

/** Reads the server’s validated hasData metadata.
 * @throws When transport, HTTP status or response shape cannot establish the answer.
 */
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
