import { readProductHttpFailure } from '@/api/productHttpError';
import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts';
import { client } from '@/api/queryClient';
import { PlanningControllerError } from './planningErrors';
import type { PlanningClientContext, PlanningTransport } from './planningCacheTypes';

type PlanningClient = typeof client;

// The caller captures the proof into the context; a missing one sends an empty proof, never a newer one.
function readContextToken(context: PlanningClientContext): string | null {
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

function normalizePlanningError(error: unknown): unknown {
  const failure = readProductHttpFailure(error, 'The planning request was refused.');
  if (!failure) return error;
  return new PlanningControllerError(
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
  const { intent } = execution;
  const params = { companyId: context.companyId };
  switch (intent.operation) {
    case 'allocation.create':
      return requireReply(
        await apiClient.request('api.planning.allocation.create', {
          params,
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'allocation.createGroup':
      return requireReply(
        await apiClient.request('api.planning.allocation.createGroup', {
          params,
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'allocation.update':
      return requireReply(
        await apiClient.request('api.planning.allocation.update', {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'allocation.duplicate':
      return requireReply(
        await apiClient.request('api.planning.allocation.duplicate', {
          params: { ...params, id: intent.sourceAllocationId },
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'resource.create':
      return requireReply(
        await apiClient.request('api.planning.resource.create', {
          params,
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'resource.update':
      return requireReply(
        await apiClient.request('api.planning.resource.update', {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'resource.archive':
    case 'resource.unarchive': {
      const action = intent.operation === 'resource.archive' ? 'archive' : 'unarchive';
      return requireReply(
        await apiClient.request(`api.planning.resource.${action}`, {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    }
    case 'timeOff.create':
      return requireReply(
        await apiClient.request('api.planning.timeOff.create', {
          params,
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'timeOff.update':
      return requireReply(
        await apiClient.request('api.planning.timeOff.update', {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'timeOff.repeat':
      return requireReply(
        await apiClient.request('api.planning.timeOff.repeat', {
          params,
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'timeOff.delete':
      return requireReply(
        await apiClient.request('api.planning.timeOff.delete', {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'timeOff.deleteGroup':
      return requireReply(
        await apiClient.request('api.planning.timeOff.deleteGroup', {
          params,
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'closure.create':
      return requireReply(
        await apiClient.request('api.planning.closure.create', {
          params,
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'closure.update':
      return requireReply(
        await apiClient.request('api.planning.closure.update', {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'closure.delete':
      return requireReply(
        await apiClient.request('api.planning.closure.delete', {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'settings.update':
      return requireReply(
        await apiClient.request('api.planning.settings.update', {
          params,
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'catalogue.create': {
      const body = { ...execution, intent };
      switch (intent.entity.entity) {
        case 'clients':
          return requireReply(
            await apiClient.request('api.planning.client.create', { params, body, signal }),
          );
        case 'projects':
          return requireReply(
            await apiClient.request('api.planning.project.create', { params, body, signal }),
          );
        case 'activities':
          return requireReply(
            await apiClient.request('api.planning.activity.create', { params, body, signal }),
          );
        case 'phases':
          return requireReply(
            await apiClient.request('api.planning.phase.create', { params, body, signal }),
          );
        case 'disciplines':
          return requireReply(
            await apiClient.request('api.planning.discipline.create', { params, body, signal }),
          );
      }
      break;
    }
    case 'catalogue.update': {
      const body = { ...execution, intent };
      const target = { ...params, id: intent.entity.id };
      switch (intent.entity.entity) {
        case 'clients':
          return requireReply(
            await apiClient.request('api.planning.client.update', { params: target, body, signal }),
          );
        case 'projects':
          return requireReply(
            await apiClient.request('api.planning.project.update', {
              params: target,
              body,
              signal,
            }),
          );
        case 'activities':
          return requireReply(
            await apiClient.request('api.planning.activity.update', {
              params: target,
              body,
              signal,
            }),
          );
        case 'phases':
          return requireReply(
            await apiClient.request('api.planning.phase.update', { params: target, body, signal }),
          );
        case 'disciplines':
          return requireReply(
            await apiClient.request('api.planning.discipline.update', {
              params: target,
              body,
              signal,
            }),
          );
      }
      break;
    }
    case 'catalogue.archive':
    case 'catalogue.unarchive': {
      const action = intent.operation === 'catalogue.archive' ? 'archive' : 'unarchive';
      const body = { ...execution, intent };
      const target = { ...params, id: intent.entity.id };
      switch (intent.entity.entity) {
        case 'clients':
          return requireReply(
            await apiClient.request(`api.planning.client.${action}`, {
              params: target,
              body,
              signal,
            }),
          );
        case 'projects':
          return requireReply(
            await apiClient.request(`api.planning.project.${action}`, {
              params: target,
              body,
              signal,
            }),
          );
        case 'activities':
          return requireReply(
            await apiClient.request(`api.planning.activity.${action}`, {
              params: target,
              body,
              signal,
            }),
          );
      }
      break;
    }
    case 'catalogue.delete': {
      const body = { ...execution, intent };
      const target = { ...params, id: intent.entity.id };
      return intent.entity.entity === 'phases'
        ? requireReply(
            await apiClient.request('api.planning.phase.delete', { params: target, body, signal }),
          )
        : requireReply(
            await apiClient.request('api.planning.discipline.delete', {
              params: target,
              body,
              signal,
            }),
          );
    }
    case 'allocation.delete':
      return requireReply(
        await apiClient.request('api.planning.allocation.delete', {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case 'allocation.deleteGroup':
      return requireReply(
        await apiClient.request('api.planning.allocation.deleteGroup', {
          params,
          body: { ...execution, intent },
          signal,
        }),
      );
  }
  throw new PlanningControllerError(
    'This planning operation is not available.',
    'VALIDATION_ERROR',
    400,
  );
}

/** Calls implemented generated routes directly; this transport never owns or persists planning data. */
export function createPlanningTransport(apiClient: PlanningClient = client): PlanningTransport {
  return {
    async read(context, signal, { window, historyId } = {}) {
      try {
        const scopedClient = applyMasqueradeContext(apiClient, readContextToken(context));
        const snapshot = requireReply(
          await scopedClient.request('api.planning.show', {
            params: { companyId: context.companyId },
            query: {
              ...(window ? { from: window.from, to: window.to } : {}),
              ...(historyId === undefined ? {} : { historyId }),
            },
            signal,
          }),
        );
        if (snapshot.companyId !== context.companyId) {
          throw new PlanningControllerError("The server returned another company's planning data.");
        }
        const authority = snapshot.authority;
        if (typeof authority.canWrite !== 'boolean') {
          throw new PlanningControllerError('The server returned an invalid planning authority.');
        }
        return {
          revision: snapshot.revision,
          canWrite: authority.canWrite,
          data: snapshot.data,
          today: snapshot.today,
          capacity: snapshot.capacity,
          history: snapshot.history,
          accessKey: JSON.stringify([
            authority.actorId,
            authority.effectiveActorId,
            authority.role,
            authority.canWrite,
            authority.canSeePrivateNames,
            authority.canSeeTimeOffNote,
          ]),
        };
      } catch (error) {
        throw normalizePlanningError(error);
      }
    },
    async execute(context, execution, signal) {
      try {
        return await sendOperation(
          applyMasqueradeContext(apiClient, readContextToken(context)),
          context,
          execution,
          signal,
        );
      } catch (error) {
        throw normalizePlanningError(error);
      }
    },
    async undo(context, step, signal) {
      try {
        return requireReply(
          await applyMasqueradeContext(apiClient, readContextToken(context)).request(
            'api.planning.undo',
            { params: { companyId: context.companyId }, body: step, signal },
          ),
        );
      } catch (error) {
        throw normalizePlanningError(error);
      }
    },
    async redo(context, step, signal) {
      try {
        return requireReply(
          await applyMasqueradeContext(apiClient, readContextToken(context)).request(
            'api.planning.redo',
            { params: { companyId: context.companyId }, body: step, signal },
          ),
        );
      } catch (error) {
        throw normalizePlanningError(error);
      }
    },
  };
}
