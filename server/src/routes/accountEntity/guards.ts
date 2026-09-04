import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyReply } from "fastify";
import type { SanitizeWriteOptions } from "../../fieldPolicy";

import type { AccountEntityRouteDependencies } from "./dependencies";
import { ACCOUNT_FROZEN_FIELDS_MESSAGE, accountFieldsFrozen } from "./policy";

/** Both account write paths turn an AccountContractError into the account failure shape and
 *  anything else into the generic redacted failure — one funnel, as the generic routes had. */
export function accountRouteFailure(
  reply: FastifyReply,
  error: unknown,
  dependencies: AccountEntityRouteDependencies,
): FastifyReply {
  return error instanceof AccountContractError
    ? dependencies.accountFail(reply, error)
    : dependencies.fail(reply, error);
}

/**
 * The three account-write guards PUT and PATCH both run, byte-identical status codes/bodies, in
 * this fixed order: ownsRow's accountId-immutability 404, the P1.14 frozen-fields 409, then the
 * optimistic-concurrency stale-write 409. Returns true once a response has been sent (the caller
 * must return immediately); false when the write may proceed.
 *
 * PUT interleaves unrelated code (computing `vis`, its trusted-local replay attempt) BETWEEN the
 * frozen guard and the stale guard, so it calls this helper twice — once for `ownsRow`+`frozen`,
 * once afterward for `stale` alone — to keep that interleaving, and therefore behavior, unchanged.
 * PATCH has nothing between the three checks and calls this once with all three.
 *
 * `existing` stays optional (unlike PATCH's already-narrowed row) because PUT also runs the
 * ownsRow/frozen pair on its CREATE path, before any row exists. The stale branch only reaches
 * `existing!` once isStaleWrite's own type guard has confirmed a stored row exists — same
 * non-null assertion the inline PUT check used.
 */
export function accountWriteGuards(params: {
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
}): boolean {
  const { reply, existing, ownsRow, isStaleWrite, redact, checkOwnsRow, checkFrozen, checkStale } = params;
  if (checkOwnsRow && !ownsRow(existing, checkOwnsRow.accountId)) {
    reply.code(404).send({ error: "Not found" });
    return true;
  }
  if (checkFrozen && accountFieldsFrozen(existing, checkFrozen.candidate)) {
    reply.code(409).send({ error: ACCOUNT_FROZEN_FIELDS_MESSAGE });
    return true;
  }
  if (
    checkStale &&
    checkStale.optimisticConcurrency &&
    isStaleWrite(existing, checkStale.candidateRow, checkStale.requirePrecondition)
  ) {
    reply.code(409).send({
      error: "The record was modified more recently on the server.",
      current: redact("accounts", existing!, checkStale.vis),
    });
    return true;
  }
  return false;
}
