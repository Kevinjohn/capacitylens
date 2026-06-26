import { useMemo } from 'react'
import { useStore } from './useStore'
import { scopeData } from './selectors'
import { activeOnly } from '@capacitylens/shared/domain/lifecycle'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData } from '@capacitylens/shared/types/entities'

// The single read-side seam for multi-tenancy: every component that used to read
// `s.data` (or a slice of it) reads through here instead, getting only the active
// account's entities. Memoised on (data, activeAccountId) so the scoped object is
// stable between renders — avoiding the useSyncExternalStore fresh-object trap.
export function useScopedData(): AppData {
  const data = useStore((s) => s.data)
  const activeAccountId = useStore((s) => s.activeAccountId)
  return useMemo(
    () => (activeAccountId ? scopeData(data, activeAccountId) : emptyAppData()),
    [data, activeAccountId],
  )
}

// The active-only VIEW projection (P2.4): the same scoped AppData as useScopedData, but with every
// NON-active (archived OR soft-deleted) resource/client/project removed via the SHARED `activeOnly`
// helper — so the rule is single-sourced with the server's per-account read. Use this in the NORMAL
// app VIEWS (scheduler, lists, forms' option-pickers, command palette, toolbar filters); use the raw
// useScopedData ONLY for non-view consumers that must see ALL rows — today just export (ImportExport),
// where archived/deleted rows are retained in the backup. Memoised on the scoped base so the projected
// object is stable between renders (same useSyncExternalStore stability contract as useScopedData).
export function useActiveScopedData(): AppData {
  const base = useScopedData()
  return useMemo(() => activeOnly(base), [base])
}
