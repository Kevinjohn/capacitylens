import type { AccountContractError } from "@capacitylens/shared/account/errors";
import type { Role } from "@capacitylens/shared/account/types";
import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { FastifyRequest } from "fastify";
import { REPLY_ERRORS } from "../../../routes/replyErrors";
import type { ParseResult } from "../../../routes/routeShared";
import type { AccountRouteContext } from "../createReplyHelpers";
import { parseStrictIsoInstant } from "../isoInstant";

function parsePreauthorizedEmail(
  value: unknown,
  createValidationFailure: AccountRouteContext["validationFailed"],
): ParseResult<string | null, AccountContractError> {
  if (value !== undefined && typeof value !== "string") {
    return { kind: "invalid", failure: createValidationFailure(REPLY_ERRORS.preauthEmailInvalid) };
  }
  if (typeof value !== "string" || value.trim().length === 0) return { kind: "parsed", value: null };
  return { kind: "parsed", value: normalizeAccountEmail(value) };
}

export function parseInvitationExpiry(
  value: unknown,
  createValidationFailure: AccountRouteContext["validationFailed"],
): ParseResult<string | null, AccountContractError> {
  if (value === undefined) return { kind: "parsed", value: null };
  const parsed = typeof value === "string" ? parseStrictIsoInstant(value) : null;
  if (parsed === null) {
    return { kind: "invalid", failure: createValidationFailure(REPLY_ERRORS.expiresAtInvalid) };
  }
  return { kind: "parsed", value: new Date(parsed).toISOString() };
}

export function parseCreateInvitationAuthorizationInput({
  req,
  authMode,
  isKnownRole,
  createValidationFailure,
}: {
  req: FastifyRequest;
  authMode: AccountRouteContext["authMode"];
  isKnownRole: AccountRouteContext["isKnownRole"];
  createValidationFailure: AccountRouteContext["validationFailed"];
}): ParseResult<
  {
    accountId: string;
    role: Role;
    preauthEmail: string | null;
    proposedResourceId?: string;
    requestedExpiry: unknown;
  },
  AccountContractError
> {
  const body = (req.body ?? {}) as {
    accountId?: unknown;
    role?: unknown;
    expiresAt?: unknown;
    preauthEmail?: unknown;
    proposedResourceId?: unknown;
  };
  if (typeof body.accountId !== "string" || body.accountId.length === 0) {
    return { kind: "invalid", failure: createValidationFailure(REPLY_ERRORS.accountIdNonEmpty) };
  }
  if (!isKnownRole(body.role)) return { kind: "invalid", failure: createValidationFailure(REPLY_ERRORS.invalidRole) };

  const emailResult = parsePreauthorizedEmail(body.preauthEmail, createValidationFailure);
  if (emailResult.kind === "invalid") return { kind: "invalid", failure: emailResult.failure };
  if (authMode === "sso-only" && emailResult.value === null) {
    return {
      kind: "invalid",
      failure: createValidationFailure(REPLY_ERRORS.ssoInvitationRequiresEmail),
    };
  }

  return {
    kind: "parsed",
    value: {
      accountId: body.accountId,
      role: body.role,
      preauthEmail: emailResult.value,
      ...(body.proposedResourceId === undefined
        ? {}
        : {
            proposedResourceId: typeof body.proposedResourceId === "string" ? body.proposedResourceId.trim() : "",
          }),
      requestedExpiry: body.expiresAt,
    },
  };
}
