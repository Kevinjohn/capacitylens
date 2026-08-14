import { useStore } from "./useStore";
import { scopeData } from "./selectors";
import { activeOnly } from "@capacitylens/shared/domain/lifecycle";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";

const emptyScopedData = emptyAppData();
const scopedCache = new WeakMap<AppData, Map<string, AppData>>();
const activeCache = new WeakMap<AppData, AppData>();

/**
 * The scoped slice for one tenant, memoised on `(data, accountId)`. Exported so IMPERATIVE readers
 * (`useStore.getState()` inside a gesture handler) hit the SAME cache as the hooks below instead of
 * re-scoping the whole blob per event; the hooks' stability contract is unchanged.
 */
export function sharedScopedData(data: AppData, accountId: string | null): AppData {
  if (!accountId) return emptyScopedData;
  let byAccount = scopedCache.get(data);
  if (!byAccount) {
    byAccount = new Map();
    scopedCache.set(data, byAccount);
  }
  let scoped = byAccount.get(accountId);
  if (!scoped) {
    scoped = scopeData(data, accountId);
    byAccount.set(accountId, scoped);
  }
  return scoped;
}

/** The active-only projection of an already-scoped slice, memoised on it. Exported alongside
 *  {@link sharedScopedData} for the same imperative-caller reason. */
export function sharedActiveData(data: AppData): AppData {
  let active = activeCache.get(data);
  if (!active) {
    active = activeOnly(data);
    activeCache.set(data, active);
  }
  return active;
}

/**
 * The read-side seam for multi-tenancy. Components receive only the active account's entities.
 *
 * Memoised on `(data, activeAccountId)` so the scoped object is stable between renders — avoiding the
 * `useSyncExternalStore` fresh-object trap.
 *
 * @returns The active account's {@link AppData} slice, or an empty `AppData` when no account is active.
 */
export function useScopedData(): AppData {
  return useStore((state) => sharedScopedData(state.data, state.activeAccountId));
}

/**
 * The active-only view projection: the same scoped AppData as {@link useScopedData}, but with
 * every NON-active (archived OR soft-deleted) resource/client/project removed via the SHARED
 * `activeOnly` helper — so the rule is single-sourced with the server's per-account read.
 *
 * Use this in the NORMAL app VIEWS (scheduler, lists, forms' option-pickers, command palette, toolbar
 * filters); use the raw {@link useScopedData} only for consumers such as export that must retain
 * archived/deleted rows. Memoised
 * on the scoped base so the projected object is stable between renders (same `useSyncExternalStore`
 * stability contract as {@link useScopedData}).
 *
 * @returns The active account's {@link AppData} slice with archived/soft-deleted rows excluded.
 */
export function useActiveScopedData(): AppData {
  const base = useScopedData();
  return sharedActiveData(base);
}

/**
 * The inactive-data source for the client-admin view — the counterpart to
 * {@link useActiveScopedData}. It returns the RAW scoped AppData (every row: active, archived AND
 * soft-deleted) WITHOUT the active-only projection, so the admin view can partition the rows by
 * `lifecycleStatus(e)` and list the archived / deleted ones the normal views hide.
 *
 * This is the DEMO-build / OFF source of those rows: in the demo build the store's `data` blob already holds
 * the archived/deleted rows (the lifecycle store actions mutate it in place), so the raw scoped slice
 * IS the full picture.
 *
 * SERVER MODE NOTE: in server mode the per-account read narrows to ACTIVE rows only (`activeOnly`
 * runs server-side in `readSlice`), so the store's `data` holds no archived/deleted rows. The admin
 * view (ArchivedSection) instead fetches them directly with `?includeInactive=1`; this hook is the
 * DEMO-build/OFF source only.
 * Returns {@link useScopedData} unchanged. The distinct name makes the admin view's intent explicit.
 *
 * @returns The active account's RAW {@link AppData} slice including archived and soft-deleted rows.
 */
export function useInactiveScopedData(): AppData {
  return useScopedData();
}
