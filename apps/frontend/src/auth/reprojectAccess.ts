import { useStore } from '@/store/useStore'
import { refreshCompanySummaries } from './useCompanySummaries'

/** Reload every actor-dependent read model while server writes remain suspended. */
export async function reprojectAccess(
  companyId: string,
  includeCompanySummaries = true
): Promise<boolean> {
  useStore.getState().invalidateMemberships()
  if (includeCompanySummaries) {
    const summaries = await refreshCompanySummaries({
      preserveActiveCompanyIfMissing: true,
    })
    if (summaries === null) return false
  }
  return (
    useStore.getState().activeCompanyId === companyId &&
    useStore.getState().refreshPlanning({ fresh: true })
  )
}
