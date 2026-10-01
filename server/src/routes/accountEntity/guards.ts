import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyReply } from "fastify";
import type { SanitizeWriteOptions } from "../../fieldPolicy";

import type { AccountEntityRouteDependencies } from "./AccountEntityRouteDependencies";
import { hasFrozenAccountFieldChanges } from "./policy";
import { FROZEN_REPLY_MESSAGES, REPLY_ERRORS } from "../replyErrors";

type AccountRouteFailureDependencies = Pick<AccountEntityRouteDependencies, "accountFail" | "fail">;

/** Both account write paths turn an AccountContractError into the account failure shape and
 *  anything else into the generic redacted failure — one funnel, as the generic routes had. */
export function sendAccountRouteFailure(
  reply: FastifyReply,
  error: unknown,
  dependencies: AccountRouteFailureDependencies,
): FastifyReply {
  return error instanceof AccountContractError
    ? dependencies.accountFail(reply, error)
    : dependencies.fail(reply, error);
}

/**
 * The three account-write guards PUT and PATCH both run, byte-identical status codes/bodies, in
 * this fixed order: ownsRow's accountId-immutability 404, the P1.14 frozen-fields 409, then the
 * optimistic-concurrency stale-write 409. Returns the sent refusal (the caller must return it
 * immediately), or null when the write may proceed.
 *
 * PUT interleaves unrelated code (computing `vis`, its trusted-local replay attempt) BETWEEN the
 * frozen guard and the stale guard, so it calls this helper twice — once for `ownsRow`+`frozen`,
 * once afterward for `stale` alone — to keep that interleaving, and therefore behavior, unchanged.
 * PATCH has nothing between the three checks and calls this once with all three.
 *
 * `existing` stays optional (unlike PATCH's already-narrowed row) because PUT also runs the
 * ownsRow/frozen pair on its CREATE path, before any row exists. A stale result without a stored
 * row is an invalid dependency result and fails loudly before redaction.
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
