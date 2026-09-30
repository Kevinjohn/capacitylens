import type { FastifyReply, FastifyRequest } from "fastify";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { NO_REPROMPT } from "../../../routes/routeShared";
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

/** Create, retry, or change one member/person association under opaque revision CAS. */
export async function setMemberResourceLink(req: FastifyRequest, reply: FastifyReply, context: MemberLinkContext) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
  if (!context.authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT }))
    return;
  const body = req.body as Record<string, unknown> | null;
  if (
    !body ||
    typeof body.resourceId !== "string" ||
    body.resourceId.length === 0 ||
    !(body.expectedRevision === null || typeof body.expectedRevision === "string")
  ) {
    return context.fail(reply, context.validationFailed("resourceId and expectedRevision are required."));
  }
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
export async function clearMemberResourceLink(req: FastifyRequest, reply: FastifyReply, context: MemberLinkContext) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
  if (!context.authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT }))
    return;
  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body.expectedRevision !== "string" || body.expectedRevision.length === 0) {
    return context.fail(reply, context.validationFailed("expectedRevision is required."));
  }
  try {
    const actor = requireAccountActor(req);
    await context.memberResources.clearLink({
      workspaceId: accountId,
      principalId: userId,
      expectedRevision: body.expectedRevision,
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
  req: FastifyRequest,
  reply: FastifyReply,
  context: MemberLinkContext,
) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
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
