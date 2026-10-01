import type { FastifyReply, FastifyRequest } from "fastify";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { REPLY_ERRORS } from "../../../routes/replyErrors";
import { NO_REPROMPT, type ParseResult } from "../../../routes/routeShared";
import type { MemberRoute } from "../accountRouteDependencies";
import type { AccountRouteContext } from "../createReplyHelpers";
import { requireAccountActor } from "./authenticatedPrincipal";

type MemberLinkContext = Pick<
  AccountRouteContext,
  "authorizeMemberMutation" | "command" | "fail" | "memberResources" | "validationFailed"
>;

function linkFailure(error: unknown): never {
  if (error instanceof Error && error.name === "AccountMemberResourceConflict") {
    throw new AccountContractError({ code: "CONFLICT", message: error.message, retryable: false }, { cause: error });
  }
  throw error;
}

function parseSetLinkBody(
  value: unknown,
  createValidationFailure: MemberLinkContext["validationFailed"],
): ParseResult<{ resourceId: string; expectedRevision: string | null }, AccountContractError> {
  const body = value as Record<string, unknown> | null;
  if (
    !body ||
    typeof body.resourceId !== "string" ||
    body.resourceId.length === 0 ||
    !(body.expectedRevision === null || typeof body.expectedRevision === "string")
  ) {
    return { kind: "invalid", failure: createValidationFailure(REPLY_ERRORS.resourceLinkInputInvalid) };
  }
  return { kind: "parsed", value: { resourceId: body.resourceId, expectedRevision: body.expectedRevision } };
}

function parseExpectedRevision(
  value: unknown,
  createValidationFailure: MemberLinkContext["validationFailed"],
): ParseResult<string, AccountContractError> {
  const body = value as Record<string, unknown> | null;
  if (!body || typeof body.expectedRevision !== "string" || body.expectedRevision.length === 0) {
    return { kind: "invalid", failure: createValidationFailure(REPLY_ERRORS.expectedRevisionRequired) };
  }
  return { kind: "parsed", value: body.expectedRevision };
}

/** Create, retry, or change one member/person association under opaque revision CAS. */
export async function setMemberResourceLink(
  req: FastifyRequest<MemberRoute>,
  reply: FastifyReply,
  context: MemberLinkContext,
) {
  const { accountId, userId } = req.params;
  if (!context.authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT }))
    return;
  const parsed = parseSetLinkBody(req.body, context.validationFailed);
  if (parsed.kind === "invalid") return context.fail(reply, parsed.failure);
  const body = parsed.value;
  try {
    const actor = requireAccountActor(req);
    const link = await context.memberResources.setLink({
      workspaceId: accountId,
      principalId: userId,
      resourceId: body.resourceId,
      expectedRevision: body.expectedRevision,
      now: new Date().toISOString(),
      actor,
      command: context.command(req),
    });
    return reply.code(200).send({ resourceId: link.resourceId, revision: link.revision });
  } catch (error) {
    try {
      linkFailure(error);
    } catch (failure) {
      return context.fail(reply, failure);
    }
  }
}

/** Remove one member/person association only when its opaque revision still matches. */
export async function clearMemberResourceLink(
  req: FastifyRequest<MemberRoute>,
  reply: FastifyReply,
  context: MemberLinkContext,
) {
  const { accountId, userId } = req.params;
  if (!context.authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT }))
    return;
  const parsed = parseExpectedRevision(req.body, context.validationFailed);
  if (parsed.kind === "invalid") return context.fail(reply, parsed.failure);
  try {
    const actor = requireAccountActor(req);
    await context.memberResources.clearLink({
      workspaceId: accountId,
      principalId: userId,
      expectedRevision: parsed.value,
      actor,
      command: context.command(req),
    });
    return reply.code(204).send();
  } catch (error) {
    try {
      linkFailure(error);
    } catch (failure) {
      return context.fail(reply, failure);
    }
  }
}

/** Dismiss the current proposal exception without changing a live member/person link. */
export async function dismissMemberResourceLinkException(
  req: FastifyRequest<MemberRoute>,
  reply: FastifyReply,
  context: MemberLinkContext,
) {
  const { accountId, userId } = req.params;
  if (!context.authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT }))
    return;
  try {
    await context.memberResources.dismissException({
      workspaceId: accountId,
      principalId: userId,
      actor: requireAccountActor(req),
      command: context.command(req),
    });
    return reply.code(204).send();
  } catch (error) {
    return context.fail(reply, error);
  }
}
