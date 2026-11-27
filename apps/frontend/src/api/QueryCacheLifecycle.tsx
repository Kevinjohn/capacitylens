import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/authContext'
import { useStore } from '@/store/useStore'
import { clearQueryCacheForScopeChange, queryClient } from './queryClient'
import type { ApiQueryScope } from './queryClient'

const previousScopeByCache = new WeakMap<QueryClient, ApiQueryScope>()

/** Clears server data when its user, active company, or masquerade projection changes. */
export function QueryCacheLifecycle({ cache = queryClient }: { cache?: QueryClient }) {
  const { user } = useAuth()
  const companyId = useStore((state) => state.activeCompanyId)
  const masqueradeGeneration = useStore((state) =>
    state.masquerade.kind === 'inactive' ? 0 : state.masquerade.generation
  )
  const userId = user?.id ?? null
  useEffect(() => {
    const scope = { userId, companyId, masqueradeGeneration }
    const previousScope = previousScopeByCache.get(cache)
    if (previousScope) clearQueryCacheForScopeChange(cache, previousScope, scope)
    previousScopeByCache.set(cache, scope)
  }, [cache, userId, companyId, masqueradeGeneration])

  return null
}
