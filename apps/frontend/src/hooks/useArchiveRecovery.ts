import { useQuery } from '@tanstack/react-query'
import { api, scopedQueryOptions } from '@/api/queryClient'
import { useQueryScope } from '@/api/useQueryScope'
import { getMasqueradeToken } from '@/api/masqueradeToken'
import { useAuth } from '@/auth/authContext'
import { useCan, useRole, usePermissionStatus } from '@/auth/permissionContext'
import { buildAccessKey } from '@/data/planning/planningAccess'
import { useStore } from '@/store/useStore'
import { m } from '@/i18n'
import { resolveErrorMessage } from '@/lib/errorMessage'

/** Reads recovery identities; the scoped query key and the cache lifecycle keep one projection's rows from another. */
export function useArchiveRecovery() {
  const { user } = useAuth()
  const role = useRole()
  const permissionStatus = usePermissionStatus()
  const mayWrite = useCan('planning:write')
  const companyId = useStore((state) => state.activeCompanyId)
  const planning = useStore((state) => state.planning)
  const accessKey = buildAccessKey(planning.access)
  const enabled =
    mayWrite &&
    !!companyId &&
    !!user &&
    permissionStatus === 'resolved' &&
    planning.access !== null &&
    planning.access.actorId === user.id &&
    planning.access.effectiveActorId === user.id &&
    planning.access.role === role &&
    planning.access.canWrite &&
    planning.context?.companyId === companyId &&
    planning.phase.kind === 'ready'
  const scope = useQueryScope()
  const query = useQuery(
    scopedQueryOptions(
      api.api.planningArchive.show.queryOptions(
        { params: { companyId: companyId ?? '' } },
        {
          enabled,
          retry: false,
          refetchOnWindowFocus: false,
          tuyau: {
            abortOnUnmount: true,
            // The proof captured for this view; an empty one is explicit, never a newer context.
            headers: { 'X-Masquerade-Context': getMasqueradeToken() ?? '' },
          },
        }
      ),
      scope,
      [role, accessKey, planning.revision]
    )
  )
  if (!enabled) return { data: null, error: null }
  if (query.isError) return { data: null, error: resolveErrorMessage(query.error) }
  const recovery = query.data?.data ?? null
  if (recovery && recovery.companyId !== companyId) {
    return { data: null, error: m.settings_archived_err_incomplete() }
  }
  return { data: recovery, error: null }
}
