import { isAccountFlowOperation, type AccountFlowOperation } from "@capacitylens/shared/account/ports";
import type { CommandIdentity } from "@capacitylens/shared/account/types";
import { isAccountCommandId, isAccountIdempotencyKey } from "@capacitylens/shared/account/validation";
import type { FastifyReply, FastifyRequest } from "fastify";
import { REPLY_ERRORS } from "../../../routes/replyErrors";
import type { ParseResult } from "../../../routes/routeShared";
import type { AccountRouteContext } from "../createReplyHelpers";

function parseReconcileBody(
  value: unknown,
): ParseResult<{ command: CommandIdentity; operation: AccountFlowOperation }, string> {
  const body = (value ?? {}) as {
    commandId?: unknown;
    operation?: unknown;
    idempotencyKey?: unknown;
  };
  if (
    !isAccountCommandId(body.commandId) ||
    !isAccountIdempotencyKey(body.idempotencyKey) ||
    !isAccountFlowOperation(body.operation)
  )
    return { kind: "invalid", failure: REPLY_ERRORS.reconcileInputInvalid };
  return {
    kind: "parsed",
    value: {
      command: { commandId: body.commandId, idempotencyKey: body.idempotencyKey },
      operation: body.operation,
    },
  };
}

export async function reconcile(
  req: FastifyRequest,
  reply: FastifyReply,
  context: Pick<AccountRouteContext, "fail" | "flows">,
) {
  const { flows: accountFlows, fail: accountFail } = context;

  const parsed = parseReconcileBody(req.body);
  if (parsed.kind === "invalid") return reply.code(400).send({ error: parsed.failure });
  try {
    const outcome = await accountFlows.reconcileCommand(parsed.value);
    if (!outcome) return reply.code(404).send({ error: REPLY_ERRORS.commandNotFound });
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
