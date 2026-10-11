import { isAccountSessionId } from "@capacitylens/shared/account/validation";
import type { FastifyReply, FastifyRequest } from "fastify";
import { REPLY_ERRORS } from "../../../routes/replyErrors";
import type { SessionRoute } from "../accountRouteDependencies";
import type { AccountRouteContext } from "../createReplyHelpers";
import { requireAccountActor } from "./authenticatedPrincipal";

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

/**
 * Ends the current authenticated session.
 */
export async function signOut(
  req: FastifyRequest,
  reply: FastifyReply,
  context: Pick<AccountRouteContext, "fail" | "identity">,
) {
  const { identity: identityPort, fail: accountFail } = context;

  try {
    const result = await identityPort.signOut({
      headers: createRequestHeaders(req.headers),
    });
    if (result.setCookies.length > 0) reply.header("set-cookie", [...result.setCookies]);
    return reply.code(200).send({ ok: true });
  } catch (error) {
    // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
    return accountFail(reply, error);
  }
}

/**
 * Lists the authenticated principal’s active sessions.
 */
export async function listSessions(
  req: FastifyRequest,
  reply: FastifyReply,
  context: Pick<AccountRouteContext, "fail" | "identity">,
) {
  const { identity: identityPort, fail: accountFail } = context;

  try {
    return reply.code(200).send({ sessions: await identityPort.listSessions({ actor: requireAccountActor(req) }) });
  } catch (error) {
    // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
    return accountFail(reply, error);
  }
}

/**
 * Revokes the selected session after confirming it belongs to the authenticated principal.
 */
export async function revokeSession(
  req: FastifyRequest<SessionRoute>,
  reply: FastifyReply,
  context: Pick<AccountRouteContext, "command" | "fail" | "identity">,
) {
  const { identity: identityPort, command: accountCommand, fail: accountFail } = context;

  const { sessionId } = req.params;
  if (!isAccountSessionId(sessionId)) {
    return reply.code(400).send({ error: REPLY_ERRORS.invalidSessionId });
  }
  try {
    await identityPort.revokeOwnSession({
      actor: requireAccountActor(req),
      sessionId,
      command: accountCommand(req),
    });
    return reply.code(204).send();
  } catch (error) {
    // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
    return accountFail(reply, error);
  }
}
