import { useStore } from './useStore';
import { activeOnly } from '@capacitylens/shared/domain/lifecycle';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { AppData } from '@capacitylens/shared/types/entities';

const emptyScopedData = emptyAppData();
const activeCache = new WeakMap<AppData, AppData>();

/** The published dataset when it is `companyId`'s, otherwise one stable empty dataset. The planning
 * read is rejected unless every row is the context company's, so only a whole dataset can belong
 * to another company: the previous one, while a company switch has not reached the planning context.
 */
export function resolveSharedScopedData(data: AppData, companyId: string | null): AppData {
  const [company, ...others] = data.accounts;
  return companyId !== null && company?.id === companyId && others.length === 0
    ? data
    : emptyScopedData;
}

/** Memoizes the active-only projection of a company-scoped slice. */
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
 * Returns the store's own `data` or one shared empty value, so the result is stable between renders,
 * avoiding the `useSyncExternalStore` fresh-object trap.
 *
 * @returns The active account's {@link AppData} slice, or an empty `AppData` when no account is active.
 */
export function useScopedData(): AppData {
  return useStore((state) => resolveSharedScopedData(state.data, state.activeCompanyId));
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
