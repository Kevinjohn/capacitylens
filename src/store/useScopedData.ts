import { useStore } from "./useStore";
import { scopeData } from "./tenancySelectors";
import { activeOnly } from "@capacitylens/shared/domain/lifecycle";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";

const emptyScopedData = emptyAppData();
const scopedCache = new WeakMap<AppData, Map<string, AppData>>();
const activeCache = new WeakMap<AppData, AppData>();

/** Memoizes a tenant slice by data identity and account ID so hooks and imperative
 * readers share one stable projection.
 */
export function resolveSharedScopedData(data: AppData, accountId: string | null): AppData {
  if (!accountId) return emptyScopedData;
  let scopedDataByAccountId = scopedCache.get(data);
  if (!scopedDataByAccountId) {
    scopedDataByAccountId = new Map();
    scopedCache.set(data, scopedDataByAccountId);
  }
  let scoped = scopedDataByAccountId.get(accountId);
  if (!scoped) {
    scoped = scopeData(data, accountId);
    scopedDataByAccountId.set(accountId, scoped);
  }
  return scoped;
}

/** Memoizes the active-only projection of an account-scoped slice. */
export function resolveSharedActiveData(data: AppData): AppData {
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
 * Memoised on `(data, activeAccountId)` so the scoped object is stable between renders, avoiding the
 * `useSyncExternalStore` fresh-object trap.
 *
 * @returns The active account's {@link AppData} slice, or an empty `AppData` when no account is active.
 */
export function useScopedData(): AppData {
  return useStore((state) => resolveSharedScopedData(state.data, state.activeAccountId));
}

/**
 * The active-only view projection: the same scoped AppData as {@link useScopedData}, but with
 * every non-active (archived or soft-deleted) resource/client/project/activity removed via the shared
 * `activeOnly` helper, so the rule is single-sourced with the server's per-account read.
 *
 * Use this in the normal app views (scheduler, lists, forms' option-pickers, command palette, toolbar
 * filters); use the raw {@link useScopedData} only for consumers such as export that must retain
 * archived/deleted rows. Memoised
 * on the scoped base so the projected object is stable between renders (same `useSyncExternalStore`
 * stability contract as {@link useScopedData}).
 *
 * @returns The active account's {@link AppData} slice with archived/soft-deleted rows excluded.
 */
export function useActiveScopedData(): AppData {
  const base = useScopedData();
  return resolveSharedActiveData(base);
}

/** Returns the raw active-account slice without applying the active-only projection. Demo slices include inactive rows; server slices remain limited to what the server hydrated, so administrative inactive views fetch includeInactive=1 separately. */
export function useInactiveScopedData(): AppData {
  return useScopedData();
}
