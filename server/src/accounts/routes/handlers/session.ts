import { AccountContractError } from "@capacitylens/shared/account/errors";
import { isAccountSessionId } from "@capacitylens/shared/account/validation";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AccountRouteContext } from "../createReplyHelpers";

function createAuthenticationRequiredError() {
  return new AccountContractError({
    code: "AUTHENTICATION_REQUIRED",
    message: "Sign in to continue.",
    retryable: false,
  });
}

function assertAccountActor(req: FastifyRequest) {
  const actor = req.accountActor;
  if (!actor) throw createAuthenticationRequiredError();
  return actor;
}

function createRequestHeaders(headers: FastifyRequest["headers"]): Headers {
  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) requestHeaders.append(key, item);
    } else if (value !== undefined) {
      requestHeaders.append(key, String(value));
    }
  }
  return requestHeaders;
}

export async function signOut(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { identity: identityPort, fail: accountFail } = context;

  try {
    const result = await identityPort.signOut({
      headers: createRequestHeaders(req.headers),
    });
    if (result.setCookies.length > 0) reply.header("set-cookie", [...result.setCookies]);
    return reply.code(200).send({ ok: true });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function listSessions(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { identity: identityPort, fail: accountFail } = context;

  try {
    return reply.code(200).send({ sessions: await identityPort.listSessions({ actor: assertAccountActor(req) }) });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function revokeSession(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { identity: identityPort, command: accountCommand, fail: accountFail } = context;

  const params: unknown = req.params;
  const sessionId =
    typeof params === "object" && params !== null && "sessionId" in params && typeof params.sessionId === "string"
      ? params.sessionId
      : undefined;
  if (!isAccountSessionId(sessionId)) {
    return reply.code(400).send({ error: "Invalid session id." });
  }
  try {
    await identityPort.revokeOwnSession({
      actor: assertAccountActor(req),
      sessionId,
      command: accountCommand(req),
    });
    return reply.code(204).send();
  } catch (error) {
    return accountFail(reply, error);
  }
}
