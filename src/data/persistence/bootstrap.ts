import type { StoreApi } from "zustand";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { StoreState } from "../../store/useStore";
import type { PersistenceAdapter } from "../PersistenceAdapter";
import { emptyAppData, isEmpty } from "@capacitylens/shared/types/entities";
import { LoadError } from "../PersistenceAdapter";
import { attachPersistence } from "../persist";

interface BootstrapOptions {
  debounceMs?: number;
  /** Used only on a genuine first run (nothing ever persisted). */
  seedIfEmpty?: AppData;
  /** Called when a persistence write fails (e.g. storage quota exceeded, or the
   *  server is unreachable). */
  onError?: (e: unknown) => void;
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

export async function bootstrap(
  store: StoreApi<StoreState>,
  adapter: PersistenceAdapter,
  opts: BootstrapOptions = {},
): Promise<() => void> {
  let loaded: AppData;
  try {
    loaded = await adapter.loadAll();
  } catch (e) {
    // Stored data couldn't be loaded. Render an empty dataset, but DELIBERATELY
    // attach NO persistence and run NO seed-save — the next mutation must not
    // overwrite recoverable data. Route to the recovery UI that fits the failure:
    //   - 'unavailable' (a remote/server load failed): a retry screen. Clearing
    //     local storage would do nothing for a server-backed app that's merely down.
    //   - 'corrupt' (local bytes present but unreadable) or any other throw: the
    //     StorageRecovery reset/import/export screen.
    store.getState().replaceAll(emptyAppData());
    store.getState().setHydrated(true);
    if (e instanceof LoadError && e.kind === "unavailable") {
      store.getState().setConnectionError(true);
    } else {
      store.getState().setLoadError(true);
    }
    return () => {};
  }
  // Seed only when nothing was ever stored — never resurrect data the user cleared.
  // hasExisting (e.g. the server's /api/meta) decides ONLY whether to seed. If it throws
  // AFTER a successful load, don't discard the loaded data or skip attaching persistence
  // (which would brick saving and show a misleading banner) — fall back to inferring
  // existence from the loaded data itself, so we still skip seeding when there's data.
  let existed: boolean;
  try {
    existed = adapter.hasExisting ? await adapter.hasExisting() : !isEmpty(loaded);
  } catch (e) {
    // hasExisting failed AFTER a good load (e.g. the server's /api/meta blipped). The fallback is
    // safe — infer existence from the loaded data, so we still skip seeding when there's data — but
    // leave a dev breadcrumb so a totally-silent meta failure isn't invisible while debugging.
    // Deliberately NOT routed to onError: this is non-fatal and would wrongly raise the persist banner.
    console.warn("bootstrap: hasExisting() failed; inferring existence from loaded data", e);
    existed = !isEmpty(loaded);
  }
  const seedNeeded = !existed && !!opts.seedIfEmpty;
  const initial = seedNeeded ? (opts.seedIfEmpty as AppData) : loaded;

  store.getState().replaceAll(initial);
  store.getState().setHydrated(true);
  // Guard the first-run seed write: a failure here (quota / private mode) must
  // surface via onError AND must NOT stop persistence from being attached —
  // otherwise the session would silently never save and never show the banner.
  if (seedNeeded) {
    try {
      await adapter.saveAll(initial);
    } catch (e) {
      opts.onError?.(e);
    }
  }

  return attachPersistence(store, adapter, opts.debounceMs ?? 300, opts.onError, opts.onSuccess, opts.serverMode);
}
