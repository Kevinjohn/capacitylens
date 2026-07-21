import { useMemo } from 'react'
import { useStore } from './useStore'
import { scopeData } from './selectors'
import { activeOnly } from '@capacitylens/shared/domain/lifecycle'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData } from '@capacitylens/shared/types/entities'

/**
 * The read-side seam for multi-tenancy. Components receive only the active account's entities.
 *
 * Memoised on `(data, activeAccountId)` so the scoped object is stable between renders — avoiding the
 * `useSyncExternalStore` fresh-object trap.
 *
 * @returns The active account's {@link AppData} slice, or an empty `AppData` when no account is active.
 */
export function useScopedData(): AppData {
  const data = useStore((s) => s.data)
  const activeAccountId = useStore((s) => s.activeAccountId)
  return useMemo(
    () => (activeAccountId ? scopeData(data, activeAccountId) : emptyAppData()),
    [data, activeAccountId],
  )
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
  const base = useScopedData()
  return useMemo(() => activeOnly(base), [base])
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
  return useScopedData()
}
