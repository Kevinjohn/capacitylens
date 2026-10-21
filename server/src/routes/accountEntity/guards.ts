import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyReply } from "fastify";
import type { SanitizeWriteOptions } from "../../fieldPolicy";

import type { AccountEntityRouteDependencies } from "./AccountEntityRouteDependencies";
import { hasFrozenAccountFieldChanges } from "./policy";
import { FROZEN_REPLY_MESSAGES, REPLY_ERRORS } from "../replyErrors";

type AccountRouteFailureDependencies = Pick<AccountEntityRouteDependencies, "accountFail" | "fail">;

/** Sends account-contract failures in their typed shape and unexpected failures through the redaction funnel. */
export function sendAccountRouteFailure(
  reply: FastifyReply,
  error: unknown,
  dependencies: AccountRouteFailureDependencies,
): FastifyReply {
  return error instanceof AccountContractError
    ? dependencies.accountFail(reply, error)
    : dependencies.fail(reply, error);
}

/** Applies the requested account guards in order: ownership, immutable fields, then stale revision.
 * Returns a sent refusal, which the caller must immediately return, or null when the write may proceed.
 * Creation may have no existing row; a stale result without one is a dependency fault.
 */
export function enforceAccountWriteGuards(input: {
  reply: FastifyReply;
  existing: Record<string, unknown> | undefined;
  ownsRow: AccountEntityRouteDependencies["ownsRow"];
  isStaleWrite: AccountEntityRouteDependencies["isStaleWrite"];
  redact: AccountEntityRouteDependencies["redact"];
  checkOwnsRow?: { accountId: unknown };
  checkFrozen?: { candidate: Record<string, unknown> };
  checkStale?: {
    optimisticConcurrency: boolean;
    candidateRow: Record<string, unknown>;
    requirePrecondition?: boolean;
    vis: SanitizeWriteOptions;
  };
}): FastifyReply | null {
  const { reply, existing, ownsRow, isStaleWrite, redact, checkOwnsRow, checkFrozen, checkStale } = input;
  if (checkOwnsRow && !ownsRow(existing, checkOwnsRow.accountId)) {
    return reply.code(404).send({ error: FROZEN_REPLY_MESSAGES.notFound });
  }
  if (checkFrozen && hasFrozenAccountFieldChanges(existing, checkFrozen.candidate)) {
    return reply.code(409).send({ error: REPLY_ERRORS.accountFrozenFields });
  }
  if (
    checkStale &&
    checkStale.optimisticConcurrency &&
    isStaleWrite({ existing, row: checkStale.candidateRow, requirePrecondition: checkStale.requirePrecondition })
  ) {
    if (!existing) throw new Error("A stale account write requires an existing row.");
    return reply.code(409).send({
      error: REPLY_ERRORS.staleWrite,
      current: redact("accounts", existing, checkStale.vis),
    });
  }
  return null;
}
