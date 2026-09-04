import type { FastifyRequest } from "fastify";
import { type SessionUser } from "../auth";
import { type ApplicationSession, type CommandIdentity } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { isAccountCommandId, isAccountIdempotencyKey } from "@capacitylens/shared/account/validation";
import { newId } from "@capacitylens/shared/lib/id";

/** Node's IncomingHttpHeaders → web Headers, for Better Auth's web-standard API
 *  (getSession reads the cookie; the mounted handler gets the full set). */
export function toWebHeaders(raw: FastifyRequest["headers"]): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") headers.append(key, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(key, item);
  }
  return headers;
}

export function sessionUserFromApplicationSession(session: ApplicationSession): SessionUser {
  return {
    id: session.principal.id,
    email: session.principal.email,
    emailVerified: session.principal.emailVerified,
    name: session.principal.displayName,
    image: session.principal.image ?? null,
    twoFactorEnabled: sessionSatisfiesRequiredMfa(session),
    sessionCreatedAt: session.createdAt,
  };
}

/** CapacityLens treats provider-authenticated and trusted-local sessions as satisfying its local
 * MFA gate; provider-side MFA enforcement remains an explicit operator responsibility. */
export function sessionSatisfiesRequiredMfa(session: ApplicationSession): boolean {
  return session.assurance === "mfa" || session.assurance === "federated" || session.assurance === "trusted-local";
}

export function replayAccountCommand(req: FastifyRequest): CommandIdentity | null {
  const idempotencyKey = req.headers["idempotency-key"];
  const commandId = req.headers["x-account-command-id"];
  return isAccountIdempotencyKey(idempotencyKey) && isAccountCommandId(commandId)
    ? { commandId, idempotencyKey }
    : null;
}

export function accountCommand(req: FastifyRequest): CommandIdentity {
  const rawIdempotency = req.headers["idempotency-key"];
  const rawCommand = req.headers["x-account-command-id"];
  if (rawIdempotency !== undefined && !isAccountIdempotencyKey(rawIdempotency)) {
    throw new AccountContractError({
      code: "VALIDATION_FAILED",
      message: "Idempotency-Key must be a 16–128 character opaque base64url-style identifier.",
      retryable: false,
    });
  }
  if (rawCommand !== undefined && !isAccountCommandId(rawCommand)) {
    throw new AccountContractError({
      code: "VALIDATION_FAILED",
      message:
        "X-Account-Command-Id must be a 16–128 character independently generated, unguessable base64url-style identifier.",
      retryable: false,
    });
  }
  if ((rawIdempotency === undefined) !== (rawCommand === undefined)) {
    throw new AccountContractError({
      code: "VALIDATION_FAILED",
      message: "Idempotency-Key and X-Account-Command-Id must be supplied together.",
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
