import { useAuth } from '@/auth/authContext'
import { useStore } from '@/store/useStore'
import type { ApiQueryScope } from './queryClient'

/** The identity scope of the signed-in user, active company and view-as projection. */
export function useQueryScope(): ApiQueryScope {
  const { user } = useAuth()
  const companyId = useStore((state) => state.activeCompanyId)
  const masqueradeGeneration = useStore((state) =>
    state.masquerade.kind === 'inactive' ? 0 : state.masquerade.generation
  )
  return { userId: user?.id ?? null, companyId, masqueradeGeneration }
}
