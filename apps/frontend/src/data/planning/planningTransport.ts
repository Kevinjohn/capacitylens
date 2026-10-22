import { TuyauHTTPError } from "@tuyau/core/client";
import type { PlanningExecution, PlanningMutationSuccess } from "@capacitylens/backend/planning";
import { isRecord } from "@capacitylens/shared/lib/isRecord";
import { client } from "@/api/queryClient";
import { PlanningControllerError } from "./planningCacheController";
import type { PlanningClientContext, PlanningTransport } from "./planningCacheController";

type PlanningClient = typeof client;

// The generated controller union includes its void refusal branch. A missing success body
// cannot acknowledge an execution, even when the HTTP status was successful.
function requireReply<T>(reply: T | void): T {
  if (reply === undefined) throw new Error("The planning response contained no acknowledgement.");
  return reply;
}

function planningError(error: unknown): unknown {
  if (!(error instanceof TuyauHTTPError)) return error;
  const body: unknown = error.response;
  const message = isRecord(body) && typeof body.error === "string" ? body.error : "The planning request was refused.";
  const code = isRecord(body) && typeof body.code === "string" ? body.code : undefined;
  const count =
    isRecord(body) &&
    Number.isSafeInteger(body.restorableItemCount) &&
    typeof body.restorableItemCount === "number" &&
    body.restorableItemCount >= 0
      ? body.restorableItemCount
      : undefined;
  return new PlanningControllerError(message, code, error.status, false, count);
}

async function sendOperation(
  apiClient: PlanningClient,
  context: PlanningClientContext,
  execution: PlanningExecution,
  signal: AbortSignal,
): Promise<PlanningMutationSuccess> {
  const { intent } = execution;
  const params = { accountId: context.companyId };
  switch (intent.operation) {
    case "allocation.create":
      return requireReply(
        await apiClient.request("api.planning.allocation.create", { params, body: { ...execution, intent }, signal }),
      );
    case "allocation.createGroup":
      return requireReply(
        await apiClient.request("api.planning.allocation.createGroup", {
          params,
          body: { ...execution, intent },
          signal,
        }),
      );
    case "allocation.update":
      return requireReply(
        await apiClient.request("api.planning.allocation.update", {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case "allocation.duplicate":
      return requireReply(
        await apiClient.request("api.planning.allocation.duplicate", {
          params: { ...params, id: intent.sourceAllocationId },
          body: { ...execution, intent },
          signal,
        }),
      );
    case "allocation.repeat":
      return requireReply(
        await apiClient.request("api.planning.allocation.repeat", {
          params: { ...params, id: intent.sourceAllocationId },
          body: { ...execution, intent },
          signal,
        }),
      );
    case "resource.create":
      return requireReply(
        await apiClient.request("api.planning.resource.create", { params, body: { ...execution, intent }, signal }),
      );
    case "resource.update":
      return requireReply(
        await apiClient.request("api.planning.resource.update", {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case "resource.archive":
    case "resource.unarchive": {
      const action = intent.operation === "resource.archive" ? "archive" : "unarchive";
      return requireReply(
        await apiClient.request(`api.planning.resource.${action}`, {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    }
    case "timeOff.create":
      return requireReply(
        await apiClient.request("api.planning.timeOff.create", { params, body: { ...execution, intent }, signal }),
      );
    case "timeOff.update":
      return requireReply(
        await apiClient.request("api.planning.timeOff.update", {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case "timeOff.repeat":
      return requireReply(
        await apiClient.request("api.planning.timeOff.repeat", { params, body: { ...execution, intent }, signal }),
      );
    case "timeOff.delete":
      return requireReply(
        await apiClient.request("api.planning.timeOff.delete", {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case "timeOff.deleteGroup":
      return requireReply(
        await apiClient.request("api.planning.timeOff.deleteGroup", { params, body: { ...execution, intent }, signal }),
      );
    case "closure.create":
      return requireReply(
        await apiClient.request("api.planning.closure.create", { params, body: { ...execution, intent }, signal }),
      );
    case "closure.update":
      return requireReply(
        await apiClient.request("api.planning.closure.update", {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case "closure.delete":
      return requireReply(
        await apiClient.request("api.planning.closure.delete", {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case "settings.update":
      return requireReply(
        await apiClient.request("api.planning.settings.update", { params, body: { ...execution, intent }, signal }),
      );
    case "catalogue.create": {
      const body = { ...execution, intent };
      switch (intent.entity.entity) {
        case "clients":
          return requireReply(await apiClient.request("api.planning.client.create", { params, body, signal }));
        case "projects":
          return requireReply(await apiClient.request("api.planning.project.create", { params, body, signal }));
        case "activities":
          return requireReply(await apiClient.request("api.planning.activity.create", { params, body, signal }));
        case "phases":
          return requireReply(await apiClient.request("api.planning.phase.create", { params, body, signal }));
        case "disciplines":
          return requireReply(await apiClient.request("api.planning.discipline.create", { params, body, signal }));
      }
      break;
    }
    case "catalogue.update": {
      const body = { ...execution, intent };
      const target = { ...params, id: intent.entity.id };
      switch (intent.entity.entity) {
        case "clients":
          return requireReply(await apiClient.request("api.planning.client.update", { params: target, body, signal }));
        case "projects":
          return requireReply(await apiClient.request("api.planning.project.update", { params: target, body, signal }));
        case "activities":
          return requireReply(
            await apiClient.request("api.planning.activity.update", { params: target, body, signal }),
          );
        case "phases":
          return requireReply(await apiClient.request("api.planning.phase.update", { params: target, body, signal }));
        case "disciplines":
          return requireReply(
            await apiClient.request("api.planning.discipline.update", { params: target, body, signal }),
          );
      }
      break;
    }
    case "catalogue.archive":
    case "catalogue.unarchive": {
      const action = intent.operation === "catalogue.archive" ? "archive" : "unarchive";
      const body = { ...execution, intent };
      const target = { ...params, id: intent.entity.id };
      switch (intent.entity.entity) {
        case "clients":
          return requireReply(
            await apiClient.request(`api.planning.client.${action}`, { params: target, body, signal }),
          );
        case "projects":
          return requireReply(
            await apiClient.request(`api.planning.project.${action}`, { params: target, body, signal }),
          );
        case "activities":
          return requireReply(
            await apiClient.request(`api.planning.activity.${action}`, { params: target, body, signal }),
          );
      }
      break;
    }
    case "catalogue.delete": {
      const body = { ...execution, intent };
      const target = { ...params, id: intent.entity.id };
      return intent.entity.entity === "phases"
        ? requireReply(await apiClient.request("api.planning.phase.delete", { params: target, body, signal }))
        : requireReply(await apiClient.request("api.planning.discipline.delete", { params: target, body, signal }));
    }
    case "allocation.delete":
      return requireReply(
        await apiClient.request("api.planning.allocation.delete", {
          params: { ...params, id: intent.id },
          body: { ...execution, intent },
          signal,
        }),
      );
    case "allocation.deleteGroup":
      return requireReply(
        await apiClient.request("api.planning.allocation.deleteGroup", {
          params,
          body: { ...execution, intent },
          signal,
        }),
      );
    case "planning.restoreGroup":
      return requireReply(
        await apiClient.request("api.planning.restoreGroup", { params, body: { ...execution, intent }, signal }),
      );
  }
  throw new PlanningControllerError("This planning operation is not available.", "validation_error", 400);
}

/** Calls implemented generated routes directly; this transport never owns or persists planning data. */
export function createPlanningTransport(apiClient: PlanningClient = client): PlanningTransport {
  return {
    async read(context, signal) {
      try {
        const snapshot = requireReply(
          await apiClient.request("api.planning.show", {
            params: { accountId: context.companyId },
            signal,
          }),
        );
        if (snapshot.accountId !== context.companyId)
          throw new PlanningControllerError("The server returned another company's planning data.");
        const authority = snapshot.authority;
        if (typeof authority.canWrite !== "boolean")
          throw new PlanningControllerError("The server returned an invalid planning authority.");
        return {
          revision: snapshot.revision,
          canWrite: authority.canWrite,
          data: snapshot.data,
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
        throw planningError(error);
      }
    },
    async execute(context, execution, signal) {
      try {
        return await sendOperation(apiClient, context, execution, signal);
      } catch (error) {
        throw planningError(error);
      }
    },
    async lookup(context, mutationId, signal) {
      try {
        return requireReply(
          await apiClient.request("api.planning.lookup", {
            params: { accountId: context.companyId, mutationId },
            signal,
          }),
        );
      } catch (error) {
        throw planningError(error);
      }
    },
  };
}
