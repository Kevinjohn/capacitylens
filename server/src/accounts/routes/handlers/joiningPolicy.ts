import type { AccountContractError } from "@capacitylens/shared/account/errors";
import { parseApprovedDomains } from "@capacitylens/shared/account/approvedDomains";
import { isJoiningPolicy, type JoiningPolicySettings } from "@capacitylens/shared/account/types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { REPLY_ERRORS } from "../../../routes/replyErrors";
import { NO_REPROMPT, type ParseResult } from "../../../routes/routeShared";
import type { AccountRoute } from "../accountRouteDependencies";
import type { AccountRouteContext } from "../createReplyHelpers";
import { requireAccountActor } from "./authenticatedPrincipal";

export async function readJoiningPolicy(
  req: FastifyRequest<AccountRoute>,
  reply: FastifyReply,
  context: Pick<AccountRouteContext, "administration" | "authMode" | "authorize" | "fail">,
) {
  const { accountId } = req.params;
  if (!context.authorize({ req, reply, accountId, action: "manageInvites", options: NO_REPROMPT })) return;
  if (context.authMode === "off") return reply.code(200).send({ policy: "invitation_only", approvedDomains: [] });
  try {
    return reply
      .code(200)
      .send(
        await context.administration.readJoiningPolicy({ actor: requireAccountActor(req), workspaceId: accountId }),
      );
  } catch (error) {
    return context.fail(reply, error);
  }
}

type SetJoiningPolicyContext = Pick<
  AccountRouteContext,
  "administration" | "authMode" | "authorize" | "command" | "fail" | "validationFailed"
>;

function parseJoiningPolicyBody(
  value: unknown,
  createValidationFailure: SetJoiningPolicyContext["validationFailed"],
): ParseResult<JoiningPolicySettings, AccountContractError> {
  const body = (value ?? {}) as { policy?: unknown; approvedDomains?: unknown };
  if (!isJoiningPolicy(body.policy)) {
    return { kind: "invalid", failure: createValidationFailure(REPLY_ERRORS.joiningPolicyInvalid) };
  }
  const domains = parseApprovedDomains(body.approvedDomains);
  if (domains === null) {
    return { kind: "invalid", failure: createValidationFailure(REPLY_ERRORS.approvedDomainsInvalid) };
  }
  return { kind: "parsed", value: { policy: body.policy, approvedDomains: domains } };
}

export async function setJoiningPolicy(
  req: FastifyRequest<AccountRoute>,
  reply: FastifyReply,
  context: SetJoiningPolicyContext,
) {
  const { accountId } = req.params;
  if (!context.authorize({ req, reply, accountId, action: "manageInvites", options: NO_REPROMPT })) return;
  if (context.authMode === "off") {
    return context.fail(reply, context.validationFailed(REPLY_ERRORS.joiningPolicyAuthenticationRequired));
  }
  const parsed = parseJoiningPolicyBody(req.body, context.validationFailed);
  if (parsed.kind === "invalid") return context.fail(reply, parsed.failure);
  try {
    return reply.code(200).send(
      await context.administration.setJoiningPolicy({
        actor: requireAccountActor(req),
        workspaceId: accountId,
        settings: parsed.value,
        command: context.command(req),
      }),
    );
  } catch (error) {
    return context.fail(reply, error);
  }
}
