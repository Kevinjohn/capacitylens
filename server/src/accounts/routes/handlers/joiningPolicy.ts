import { parseApprovedDomains } from "@capacitylens/shared/account/approvedDomains";
import { isJoiningPolicy, type JoiningPolicySettings } from "@capacitylens/shared/account/types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { NO_REPROMPT } from "../../../routes/routeShared";
import type { AccountRouteContext } from "../createReplyHelpers";
import { requireAccountActor } from "./authenticatedPrincipal";

export async function readJoiningPolicy(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { accountId } = req.params as { accountId: string };
  if (!context.authorize({ req, reply, accountId, action: "manageInvites", options: NO_REPROMPT })) return;
  if (context.authMode === "off") return { policy: "invitation_only", approvedDomains: [] };
  try {
    return await context.administration.readJoiningPolicy({ actor: requireAccountActor(req), workspaceId: accountId });
  } catch (error) {
    return context.fail(reply, error);
  }
}

export async function setJoiningPolicy(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { accountId } = req.params as { accountId: string };
  if (!context.authorize({ req, reply, accountId, action: "manageInvites", options: NO_REPROMPT })) return;
  if (context.authMode === "off") return context.fail(reply, context.validationFailed("Authentication is required."));
  const body = (req.body ?? {}) as { policy?: unknown; approvedDomains?: unknown };
  if (!isJoiningPolicy(body.policy)) return context.fail(reply, context.validationFailed("Choose a valid joining policy."));
  const domains = parseApprovedDomains(body.approvedDomains);
  if (domains === null) return context.fail(reply, context.validationFailed("Approved domains must be valid DNS domains."));
  const settings: JoiningPolicySettings = { policy: body.policy, approvedDomains: domains };
  try {
    return await context.administration.setJoiningPolicy({
      actor: requireAccountActor(req),
      workspaceId: accountId,
      settings,
      command: context.command(req),
    });
  } catch (error) {
    return context.fail(reply, error);
  }
}
