import { readProductHttpFailure } from '@/api/productHttpError'
import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts'
import { client } from '@/api/queryClient'
import { PlanningCacheError } from './planningErrors'
import type { PlanningSessionScope, PlanningTransport } from './planningCacheTypes'

type PlanningClient = typeof client

// The caller captures the proof into the context; a missing one sends an empty proof, never a newer one.
function getScopeMasqueradeToken(context: PlanningSessionScope): string | null {
  return context.masqueradeToken ?? null
}

function applyMasqueradeHeader(
  apiClient: PlanningClient,
  masqueradeToken: string | null | undefined
): PlanningClient {
  return new Proxy(apiClient, {
    get(target, property, receiver) {
      if (property !== 'request') {
        const value: unknown = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (
        name: Parameters<PlanningClient['request']>[0],
        args: Parameters<PlanningClient['request']>[1]
      ) => {
        // An empty proof is explicit too: a delayed action cannot inherit a newer global context.
        return target.request(name, {
          ...args,
          headers: { ...args.headers, 'X-Masquerade-Context': masqueradeToken ?? '' },
        })
      }
    },
  })
}

// The generated controller union includes its void refusal branch. A missing success body
// cannot acknowledge an execution, even when the HTTP status was successful.
function requireReply<T>(reply: T | void): T {
  if (reply === undefined) throw new Error('The planning response contained no acknowledgement.')
  return reply
}

function mapPlanningError(error: unknown): unknown {
  const failure = readProductHttpFailure(error, 'The planning request was refused.')
  if (!failure) return error
  return new PlanningCacheError(
    failure.body.error,
    failure.body.code,
    failure.status,
    false,
    failure.body.restorableItemCount
  )
}

async function sendOperation(
  apiClient: PlanningClient,
  context: PlanningSessionScope,
  execution: PlanningExecution,
  signal: AbortSignal
): Promise<PlanningMutationSuccess> {
  return requireReply(
    await apiClient.request('api.planning_mutations.store', {
      params: { companyId: context.companyId },
      body: execution,
      signal,
    })
  ).data
}

/** Calls implemented generated routes directly; this transport never owns or persists planning data. */
export function createPlanningTransport(apiClient: PlanningClient = client): PlanningTransport {
  return {
    async read(context, signal, { window, historyId, ifRevision } = {}) {
      try {
        const scopedClient = applyMasqueradeHeader(apiClient, getScopeMasqueradeToken(context))
        const snapshot = requireReply(
          await scopedClient.request('api.planning.show', {
            params: { companyId: context.companyId },
            query: {
              ...(window ? { from: window.from, to: window.to } : {}),
              ...(historyId === undefined ? {} : { historyId }),
              ...(ifRevision === undefined ? {} : { ifRevision }),
            },
            signal,
          })
        ).data
        if (snapshot.companyId !== context.companyId) {
          throw new PlanningCacheError("The server returned another company's planning data.")
        }
        const access = snapshot.access
        if (
          typeof access.actorId !== 'string' ||
          typeof access.effectiveActorId !== 'string' ||
          typeof access.role !== 'string' ||
          typeof access.canWrite !== 'boolean' ||
          typeof access.canSeePrivateNames !== 'boolean' ||
          typeof access.canSeeTimeOffNote !== 'boolean'
        ) {
          throw new PlanningCacheError('The server returned an invalid planning access.')
        }
        const base = {
          revision: snapshot.revision,
          access: {
            actorId: access.actorId,
            effectiveActorId: access.effectiveActorId,
            role: access.role,
            canWrite: access.canWrite,
            canSeePrivateNames: access.canSeePrivateNames,
            canSeeTimeOffNote: access.canSeeTimeOffNote,
          },
          today: snapshot.today,
          capacity: snapshot.capacity,
          history: snapshot.history,
        }
        return snapshot.content === 'unchanged'
          ? { ...base, content: 'unchanged' }
          : { ...base, content: 'full', data: snapshot.data }
      } catch (error) {
        throw mapPlanningError(error)
      }
    },
    async execute(context, execution, signal) {
      try {
        return await sendOperation(
          applyMasqueradeHeader(apiClient, getScopeMasqueradeToken(context)),
          context,
          execution,
          signal
        )
      } catch (error) {
        throw mapPlanningError(error)
      }
    },
    async undo(context, step, signal) {
      try {
        return requireReply(
          await applyMasqueradeHeader(apiClient, getScopeMasqueradeToken(context)).request(
            'api.planning_undo.store',
            { params: { companyId: context.companyId }, body: step, signal }
          )
        ).data
      } catch (error) {
        throw mapPlanningError(error)
      }
    },
    async redo(context, step, signal) {
      try {
        return requireReply(
          await applyMasqueradeHeader(apiClient, getScopeMasqueradeToken(context)).request(
            'api.planning_redo.store',
            { params: { companyId: context.companyId }, body: step, signal }
          )
        ).data
      } catch (error) {
        throw mapPlanningError(error)
      }
    },
  }
}
