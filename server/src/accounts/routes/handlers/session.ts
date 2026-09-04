import { isAccountSessionId } from "@capacitylens/shared/account/validation";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AccountRouteContext } from "../replyHelpers";

export async function signOut(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const { identity: identityPort, fail: accountFail } = ctx;

  try {
    const result = await identityPort.signOut({
      headers: new Headers(
        Object.entries(req.headers).flatMap(([key, value]) =>
          Array.isArray(value)
            ? value.map((item) => [key, item] as [string, string])
            : value === undefined
              ? []
              : [[key, String(value)] as [string, string]],
        ),
      ),
    });
    if (result.setCookies.length > 0) reply.header("set-cookie", [...result.setCookies]);
    return reply.code(200).send({ ok: true });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function listSessions(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const { identity: identityPort, fail: accountFail } = ctx;

  try {
    return reply.code(200).send({ sessions: await identityPort.listSessions({ actor: req.accountActor! }) });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function revokeSession(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const { identity: identityPort, command: accountCommand, fail: accountFail } = ctx;

  const { sessionId } = req.params as { sessionId: string };
  if (!isAccountSessionId(sessionId)) {
    return reply.code(400).send({ error: "Invalid session id." });
  }
  try {
    await identityPort.revokeOwnSession({
      actor: req.accountActor!,
      sessionId,
      command: accountCommand(req),
    });
    return reply.code(204).send();
  } catch (error) {
    return accountFail(reply, error);
  }
}
