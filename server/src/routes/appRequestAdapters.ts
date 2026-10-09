import type { FastifyRequest } from "fastify";
import type { SessionUser } from "../auth";
import type { ApplicationSession, CommandIdentity } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { isAccountCommandId, isAccountIdempotencyKey } from "@capacitylens/shared/account/validation";
import { newId } from "@capacitylens/shared/lib/id";
import { REPLY_ERRORS } from "./replyErrors";

/** Node's IncomingHttpHeaders → web Headers, for Better Auth's web-standard API
 * (getSession reads the cookie; the mounted handler gets the full set). */
export function toWebHeaders(raw: FastifyRequest["headers"]): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") headers.append(key, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(key, item);
  }
  return headers;
}

export function buildSessionUser(session: ApplicationSession): SessionUser {
  return {
    id: session.principal.id,
    email: session.principal.email,
    emailVerified: session.principal.emailVerified,
    name: session.principal.displayName,
    image: session.principal.image ?? null,
    sessionCreatedAt: session.createdAt,
  };
}

export function parseReplayAccountCommand(req: FastifyRequest): CommandIdentity | null {
  const idempotencyKey = req.headers["idempotency-key"];
  const commandId = req.headers["x-account-command-id"];
  return isAccountIdempotencyKey(idempotencyKey) && isAccountCommandId(commandId)
    ? { commandId, idempotencyKey }
    : null;
}

export function createAccountCommand(req: FastifyRequest): CommandIdentity {
  const rawIdempotency = req.headers["idempotency-key"];
  const rawCommand = req.headers["x-account-command-id"];
  if (rawIdempotency !== undefined && !isAccountIdempotencyKey(rawIdempotency)) {
    throw new AccountContractError({
      code: "VALIDATION_FAILED",
      message: REPLY_ERRORS.idempotencyKeyInvalid,
      retryable: false,
    });
  }
  if (rawCommand !== undefined && !isAccountCommandId(rawCommand)) {
    throw new AccountContractError({
      code: "VALIDATION_FAILED",
      message: REPLY_ERRORS.commandIdInvalid,
      retryable: false,
    });
  }
  if ((rawIdempotency === undefined) !== (rawCommand === undefined)) {
    throw new AccountContractError({
      code: "VALIDATION_FAILED",
      message: REPLY_ERRORS.commandHeadersUnpaired,
      retryable: false,
    });
  }
  const idempotencyKey = isAccountIdempotencyKey(rawIdempotency) ? rawIdempotency : newId();
  // They serve different purposes and remain independent even for compatibility callers that do
  // not yet send either header: the command id is the reconciliation handle, while the
  // idempotency key identifies one semantic retry ceremony.
  const commandId = isAccountCommandId(rawCommand) ? rawCommand : newId();
  return { commandId, idempotencyKey };
}
