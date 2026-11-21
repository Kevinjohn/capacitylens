import { readProductHttpFailure } from '@/api/productHttpError';
import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts';
import { client } from '@/api/queryClient';
import { PlanningCacheError } from './planningErrors';
import type { PlanningClientContext, PlanningTransport } from './planningCacheTypes';

type PlanningClient = typeof client;

// The caller captures the proof into the context; a missing one sends an empty proof, never a newer one.
function getContextToken(context: PlanningClientContext): string | null {
  return context.masqueradeContextToken ?? null;
}

function applyMasqueradeContext(
  apiClient: PlanningClient,
  contextToken: string | null | undefined,
): PlanningClient {
  return new Proxy(apiClient, {
    get(target, property, receiver) {
      if (property !== 'request') {
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (
        name: Parameters<PlanningClient['request']>[0],
        args: Parameters<PlanningClient['request']>[1],
      ) => {
        // An empty proof is explicit too: a delayed action cannot inherit a newer global context.
        return target.request(name, {
          ...args,
          headers: { ...args.headers, 'X-Masquerade-Context': contextToken ?? '' },
        });
      };
    },
  });
}

// The generated controller union includes its void refusal branch. A missing success body
// cannot acknowledge an execution, even when the HTTP status was successful.
function requireReply<T>(reply: T | void): T {
  if (reply === undefined) throw new Error('The planning response contained no acknowledgement.');
  return reply;
}

function mapPlanningError(error: unknown): unknown {
  const failure = readProductHttpFailure(error, 'The planning request was refused.');
  if (!failure) return error;
  return new PlanningCacheError(
    failure.body.error,
    failure.body.code,
    failure.status,
    false,
    failure.body.restorableItemCount,
  );
}

async function sendOperation(
  apiClient: PlanningClient,
  context: PlanningClientContext,
  execution: PlanningExecution,
  signal: AbortSignal,
): Promise<PlanningMutationSuccess> {
  return requireReply(
    await apiClient.request('api.planning.mutate', {
      params: { companyId: context.companyId },
      body: execution,
      signal,
    }),
  );
}

/** Calls implemented generated routes directly; this transport never owns or persists planning data. */
export function createPlanningTransport(apiClient: PlanningClient = client): PlanningTransport {
  return {
    async read(context, signal, { window, historyId, ifRevision } = {}) {
      try {
        const scopedClient = applyMasqueradeContext(apiClient, getContextToken(context));
        const snapshot = requireReply(
          await scopedClient.request('api.planning.show', {
            params: { companyId: context.companyId },
            query: {
              ...(window ? { from: window.from, to: window.to } : {}),
              ...(historyId === undefined ? {} : { historyId }),
              ...(ifRevision === undefined ? {} : { ifRevision }),
            },
            signal,
          }),
        );
        if (snapshot.companyId !== context.companyId) {
          throw new PlanningCacheError("The server returned another company's planning data.");
        }
        const authority = snapshot.authority;
        if (
          typeof authority.actorId !== 'string' ||
          typeof authority.effectiveActorId !== 'string' ||
          typeof authority.role !== 'string' ||
          typeof authority.canWrite !== 'boolean' ||
          typeof authority.canSeePrivateNames !== 'boolean' ||
          typeof authority.canSeeTimeOffNote !== 'boolean'
        ) {
          throw new PlanningCacheError('The server returned an invalid planning authority.');
        }
        const base = {
          revision: snapshot.revision,
          authority: {
            actorId: authority.actorId,
            effectiveActorId: authority.effectiveActorId,
            role: authority.role,
            canWrite: authority.canWrite,
            canSeePrivateNames: authority.canSeePrivateNames,
            canSeeTimeOffNote: authority.canSeeTimeOffNote,
          },
          today: snapshot.today,
          capacity: snapshot.capacity,
          history: snapshot.history,
        };
        return snapshot.slice === 'unchanged'
          ? { ...base, slice: 'unchanged' }
          : { ...base, slice: 'full', data: snapshot.data };
      } catch (error) {
        throw mapPlanningError(error);
      }
    },
    async execute(context, execution, signal) {
      try {
        return await sendOperation(
          applyMasqueradeContext(apiClient, getContextToken(context)),
          context,
          execution,
          signal,
        );
      } catch (error) {
        throw mapPlanningError(error);
      }
    },
    async undo(context, step, signal) {
      try {
        return requireReply(
          await applyMasqueradeContext(apiClient, getContextToken(context)).request(
            'api.planning.undo',
            { params: { companyId: context.companyId }, body: step, signal },
          ),
        );
      } catch (error) {
        throw mapPlanningError(error);
      }
    },
    async redo(context, step, signal) {
      try {
        return requireReply(
          await applyMasqueradeContext(apiClient, getContextToken(context)).request(
            'api.planning.redo',
            { params: { companyId: context.companyId }, body: step, signal },
          ),
        );
      } catch (error) {
        throw mapPlanningError(error);
      }
    },
  };
}
