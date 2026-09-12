import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { readValidatedStateValue } from "./appTestSnapshotBatch";
export const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> => app.inject(opts);

export interface ErrorResponse {
  error: string;
  code?: string;
}

export function readErrorResponse(response: LightMyRequestResponse): ErrorResponse {
  const value: unknown = response.json();
  if (typeof value !== "object" || value === null || !("error" in value) || typeof value.error !== "string") {
    throw new Error("Expected an error response with a string error.");
  }
  if ("code" in value) {
    if (typeof value.code !== "string") {
      throw new Error("Expected an error response code to be a string.");
    }
    return { error: value.error, code: value.code };
  }
  return { error: value.error };
}

export const body = (payload: unknown) => payload as NonNullable<InjectOptions["payload"]>;

export const post = (app: FastifyInstance, entity: string, payload: unknown) =>
  call(app, { method: "POST", url: `/api/${entity}`, payload: body(payload) });

export interface PutInput {
  app: FastifyInstance;
  entity: string;
  id: string;
  payload: unknown;
}

export const put = ({ app, entity, id, payload }: PutInput) =>
  call(app, {
    method: "PUT",
    url: `/api/${entity}/${id}`,
    payload: body(payload),
  });

export interface PatchInput {
  app: FastifyInstance;
  entity: string;
  id: string;
  payload: unknown;
}

export const patch = ({ app, entity, id, payload }: PatchInput) =>
  call(app, {
    method: "PATCH",
    url: `/api/${entity}/${id}`,
    payload: body(payload),
  });

export interface DelInput {
  app: FastifyInstance;
  entity: string;
  id: string;
  accountId?: string | undefined;
}

// Scoped tables now REQUIRE an asserted owning account on DELETE; pass accountId for them.
// accounts (top-level) carry none, so accountId is omitted there.
export const del = ({ app, entity, id, accountId }: DelInput) =>
  call(app, {
    method: "DELETE",
    url: accountId ? `/api/${entity}/${id}?accountId=${accountId}` : `/api/${entity}/${id}`,
  });
export const batch = (app: FastifyInstance, ops: unknown[]) =>
  call(app, { method: "POST", url: "/api/batch", payload: body({ ops }) });

export interface OrderedBatchInput {
  app: FastifyInstance;
  sessionId: string;
  sequence: number;
  ops: unknown[];
}

export const orderedBatch = ({ app, sessionId, sequence, ops }: OrderedBatchInput) =>
  call(app, {
    method: "POST",
    url: "/api/batch",
    headers: {
      "x-capacitylens-sync-session": sessionId,
      "x-capacitylens-sync-sequence": String(sequence),
    },
    payload: body({ ops }),
  });
export const state = async (app: FastifyInstance) => {
  // Generic account creation now guarantees its required Internal client. Most legacy CRUD tests
  // predate that invariant and reason about the regular clients they explicitly create. The exact
  // state validator retains that view by filtering rows whose validated builtin flag is true.
  return readValidatedStateValue((await call(app, { method: "GET", url: "/api/state" })).json());
};
