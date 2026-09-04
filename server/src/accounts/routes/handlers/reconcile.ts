import { isAccountFlowOperation } from "@capacitylens/shared/account/ports";
import { isAccountCommandId, isAccountIdempotencyKey } from "@capacitylens/shared/account/validation";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AccountRouteContext } from "../replyHelpers";

export async function reconcile(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const { flows: accountFlows, fail: accountFail } = ctx;

  const body = (req.body ?? {}) as {
    commandId?: unknown;
    operation?: unknown;
    idempotencyKey?: unknown;
  };
  if (
    !isAccountCommandId(body.commandId) ||
    !isAccountIdempotencyKey(body.idempotencyKey) ||
    !isAccountFlowOperation(body.operation)
  )
    return reply.code(400).send({
      error: "A valid command, idempotency key, and operation are required.",
    });
  try {
    const outcome = await accountFlows.reconcileCommand({
      command: {
        commandId: body.commandId,
        idempotencyKey: body.idempotencyKey,
      },
      operation: body.operation,
    });
    if (!outcome) return reply.code(404).send({ error: "Command not found." });
    // The public ceremony is intentionally only a status oracle. Full repair coordinates stay in
    // the operator-only database/CLI path; possession of browser reconciliation bearers must not
    // disclose workspace, principal, provisional-principal, or reset-ceremony identifiers.
    return reply.code(200).send(
      outcome.status === "reconciliation-required"
        ? {
            ...outcome,
            repair: {
              kind: outcome.repair.kind,
              workspaceId: null,
              targetPrincipalId: null,
              provisionalPrincipalId: null,
              ceremonyId: null,
            },
          }
        : outcome,
    );
  } catch (error) {
    return accountFail(reply, error);
  }
}
