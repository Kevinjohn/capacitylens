import { useCallback, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateInactiveReads } from '@/api/queryClient'
import { useStore } from '@/store/useStore'
import type { LifecycleEntity } from '@/lib/entityDrafts'
import type { PlanningIntentRequest } from '@/data/planning/planningIntents'
import { resolveErrorMessage } from '@/lib/errorMessage'
import { runResourceAnonymisation } from '@/store/resourceAnonymisation'
import { buildArchiveImpactNotice } from '@/lib/archiveImpactCopy'

// Archive and restore use typed planning intents. Anonymisation has a named server route;
// uncertain results require authoritative recovery before another irreversible attempt.

type LifecycleVerb = 'archive' | 'restore' | 'anonymise'

/**
 * The dispatch surface returned by {@link useLifecycleOperations}. Each method runs one lifecycle
 * transition for one entity row. Planning operations use the shared typed planning cache;
 * anonymisation uses the server. The promise never rejects. A failure is surfaced as a notice and the promise still
 * resolves, so a caller can `void` it without an unhandled rejection (the MembersSection idiom).
 */
export interface LifecycleOperations {
  archive: (entity: LifecycleEntity, id: string) => Promise<void>
  restore: (entity: LifecycleEntity, id: string) => Promise<void>
  anonymise: (id: string) => Promise<void>
}

/** Returns lifecycle actions that serialize server mutations with authoritative reloads.
 * onReloaded fires after confirmed
 * server mutation and refresh so an independently loaded inactive list can refetch.
 */
export function useLifecycleOperations(onReloaded?: () => void): LifecycleOperations {
  const mutationQueue = useRef<Promise<void>>(Promise.resolve())
  const queryClient = useQueryClient()
  const activeCompanyId = useStore((state) => state.activeCompanyId)
  const setNotice = useStore((state) => state.setNotice)

  const dispatchServer = useCallback(
    async (verb: LifecycleVerb, entity: LifecycleEntity, id: string) => {
      if (!activeCompanyId) return
      if (verb !== 'anonymise' || entity !== 'resources') {
        throw new Error('Unsupported anonymisation target.')
      }
      const reloaded = await runResourceAnonymisation(activeCompanyId, id, setNotice)
      if (reloaded) {
        void invalidateInactiveReads(queryClient)
        onReloaded?.()
      }
    },
    [activeCompanyId, setNotice, onReloaded, queryClient]
  )

  const run = useCallback(
    (verb: LifecycleVerb, entity: LifecycleEntity, id: string): Promise<void> => {
      const execute = async () => {
        try {
          if (!activeCompanyId || useStore.getState().activeCompanyId !== activeCompanyId) return
          if (verb === 'archive' || verb === 'restore') {
            // Archiving from a list is confirmed there and is not offered for undo.
            const intentRequest: PlanningIntentRequest =
              entity === 'resources'
                ? verb === 'archive'
                  ? { intent: { operation: 'resource.archive', id }, endsHistory: true }
                  : { intent: { operation: 'resource.restore', id }, endsHistory: true }
                : verb === 'archive'
                  ? {
                      intent: { operation: 'catalogue.archive', entity: { entity, id } },
                      endsHistory: true,
                    }
                  : {
                      intent: { operation: 'catalogue.restore', entity: { entity, id } },
                      endsHistory: true,
                    }
            const receipt = await useStore.getState().sendPlanningIntent(intentRequest)
            void invalidateInactiveReads(queryClient)
            if (entity !== 'resources' && verb === 'archive' && receipt?.archived) {
              const notice = buildArchiveImpactNotice(entity, receipt.archived)
              if (notice) setNotice(notice)
            }
          } else {
            await dispatchServer(verb, entity, id)
          }
        } catch (e) {
          // Preserve the never-reject contract if dispatch fails outside the inner operation boundary.
          setNotice(resolveErrorMessage(e), 'error')
        }
      }

      // Anonymisation mutates outside typed planning sync, and each operation must complete its
      // authoritative reload before the next starts. Queue confirmed intent instead of silently
      // discarding a second click while the first transition is still settling.
      const scheduled = mutationQueue.current.then(execute, execute)
      mutationQueue.current = scheduled
      return scheduled
    },
    [activeCompanyId, dispatchServer, setNotice, queryClient]
  )

  // Stabilize the returned surface so consumers do not rerender solely because its object identity changes.
  return useMemo<LifecycleOperations>(
    () => ({
      archive: (entity, id) => run('archive', entity, id),
      restore: (entity, id) => run('restore', entity, id),
      anonymise: (id) => run('anonymise', 'resources', id),
    }),
    [run]
  )
}
