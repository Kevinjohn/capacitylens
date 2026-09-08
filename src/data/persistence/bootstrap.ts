import type { StoreApi } from "zustand";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { StoreState } from "../../store/useStore";
import type { PersistenceAdapter } from "../PersistenceAdapter";
import { emptyAppData, isEmpty } from "@capacitylens/shared/types/entities";
import { LoadError } from "../PersistenceAdapter";
import { attachPersistence } from "./attachPersistence";

interface BootstrapOptions {
  debounceMs?: number;
  /** Used only on a genuine first run (nothing ever persisted). */
  seedIfEmpty?: AppData;
  /** Called when a persistence write fails (e.g. storage quota exceeded, or the
   *  server is unreachable). */
  onError?: (error: unknown) => void;
  /** Called after a persistence write succeeds — lets the caller clear a prior
   *  error state once saving recovers (e.g. the server comes back). */
  onSuccess?: () => void;
  /** True when a backend is in use — server mode (the default; false only in the demo build,
   *  VITE_CAPACITYLENS_DEMO=1). Enables the per-account switch
   *  orchestrator (P1.13): a tenant pick hydrates that account's slice via `loadAll(accountId)` and
   *  re-seeds the diff snapshot atomically. The demo build (false) leaves the orchestrator inert — `data`
   *  already holds all accounts, so a switch is a pure view change. */
  serverMode?: boolean;
}

function handleLoadFailure(store: StoreApi<StoreState>, error: unknown): () => void {
  store.getState().replaceAll(emptyAppData());
  store.getState().setHydrated(true);
  if (error instanceof LoadError && error.kind === "unavailable") store.getState().setConnectionError(true);
  else store.getState().setLoadError(true);
  return () => {};
}

async function resolveExisting(adapter: PersistenceAdapter, loaded: AppData): Promise<boolean> {
  try {
    return adapter.hasExisting ? await adapter.hasExisting() : !isEmpty(loaded);
  } catch (error) {
    // This is non-fatal and must not raise the persistence banner after a successful data load.
    console.warn("bootstrap: hasExisting() failed; inferring existence from loaded data", error);
    return !isEmpty(loaded);
  }
}

async function saveInitialSeed(
  adapter: PersistenceAdapter,
  initial: AppData,
  onError?: (error: unknown) => void,
): Promise<void> {
  try {
    await adapter.saveAll(initial);
  } catch (error) {
    onError?.(error);
  }
}

export async function bootstrap(
  store: StoreApi<StoreState>,
  adapter: PersistenceAdapter,
  options: BootstrapOptions = {},
): Promise<() => void> {
  let loaded: AppData;
  try {
    loaded = await adapter.loadAll();
  } catch (error) {
    // Stored data couldn't be loaded. Render an empty dataset, but DELIBERATELY
    // attach NO persistence and run NO seed-save — the next mutation must not
    // overwrite recoverable data. Route to the recovery UI that fits the failure:
    //   - 'unavailable' (a remote/server load failed): a retry screen. Clearing
    //     local storage would do nothing for a server-backed app that's merely down.
    //   - 'corrupt' (local bytes present but unreadable) or any other throw: the
    //     StorageRecovery reset/import/export screen.
    return handleLoadFailure(store, error);
  }
  // Seed only when nothing was ever stored — never resurrect data the user cleared.
  // hasExisting (e.g. the server's /api/meta) decides ONLY whether to seed. If it throws
  // AFTER a successful load, don't discard the loaded data or skip attaching persistence
  // (which would brick saving and show a misleading banner) — fall back to inferring
  // existence from the loaded data itself, so we still skip seeding when there's data.
  const existed = await resolveExisting(adapter, loaded);
  const seed = options.seedIfEmpty;
  const seedNeeded = !existed && seed !== undefined;
  const initial = seedNeeded ? seed : loaded;

  store.getState().replaceAll(initial);
  store.getState().setHydrated(true);
  // Guard the first-run seed write: a failure here (quota / private mode) must
  // surface via onError AND must NOT stop persistence from being attached —
  // otherwise the session would silently never save and never show the banner.
  if (seedNeeded) await saveInitialSeed(adapter, initial, options.onError);

  return attachPersistence({
    store: store,
    adapter: adapter,
    debounceMs: options.debounceMs ?? 300,
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
    ...(options.serverMode === undefined ? {} : { serverMode: options.serverMode }),
  });
}
