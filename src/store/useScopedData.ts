import { useMemo } from 'react'
import { useStore } from './useStore'
import { scopeData } from './selectors'
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
