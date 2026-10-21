import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { CommandIdentity } from "@capacitylens/shared/account/types";
import { isAccountRole } from "@capacitylens/shared/account/types";
import type { Action } from "@capacitylens/shared/domain/access";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditRecord } from "../../audit";
import { REPLY_ERRORS } from "../../routes/replyErrors";
import type { AuthorizeRouteInput } from "../../routes/routeShared";
import { wasAccountCommandReplayed } from "../commands";
import type { AccountRouteDependencies } from "./accountRouteDependencies";

interface AuditUnlessReplayedInput {
  reply: FastifyReply;
  result: unknown;
  record: AuditRecord;
  extra?: boolean;
}
interface AuthorizeMemberMutationInput {
  req: FastifyRequest;
  reply: FastifyReply;
  accountId: string;
  action: Action;
  options?: AuthorizeRouteInput["options"];
}
interface RequireMembershipInput {
  reply: FastifyReply;
  accountId: string;
  userId: string;
  command: CommandIdentity;
}

/** Reply and gate helpers every account route handler shares; built once from the route dependencies. */
export interface AccountReplyHelpers {
  isKnownRole: typeof isAccountRole;
  validationFailed(message: string): AccountContractError;
  memberNotFound(command: CommandIdentity): AccountContractError;
  auditUnlessReplayed(input: AuditUnlessReplayedInput): void;
  rejectTrustedLocalMemberMutation(reply: FastifyReply): unknown;
  authorizeMemberMutation(input: AuthorizeMemberMutationInput): boolean;
  requireMembership(
    input: RequireMembershipInput,
  ): ReturnType<AccountRouteDependencies["administration"]["getMembership"]>;
}

/**
 * Creates reply helpers that translate account errors into HTTP responses.
 */
export function createReplyHelpers(dependencies: AccountRouteDependencies): AccountReplyHelpers {
  const { authMode, administration: accountAdminPort, authorize, audit, fail: accountFail } = dependencies;

  const isKnownRole = isAccountRole;

  const createValidationFailure = (message: string) =>
    new AccountContractError({ code: "VALIDATION_FAILED", message, retryable: false });

  const createMemberNotFoundError = (command: CommandIdentity) =>
    new AccountContractError({
      code: "NOT_FOUND",
      message: REPLY_ERRORS.notAMember,
      retryable: false,
      commandId: command.commandId,
    });

  // Every mutation route audits its own record unless the command was a replay (audit already
  // happened on first execution), `extra` lets a route fold in one more precondition (e.g.
  // "only if something actually changed") without re-deriving the replay check at each call site.
  const auditUnlessReplayed = ({ reply, result, record, extra = true }: AuditUnlessReplayedInput): void => {
    if (extra && !wasAccountCommandReplayed(result)) audit(reply, record);
  };

  // Trusted-local mode has no member identity model, so member mutations must report unavailable
  // rather than acknowledge an inert write.
  const rejectTrustedLocalMemberMutation = (reply: FastifyReply): unknown =>
    reply.code(400).send({
      error: REPLY_ERRORS.trustedLocalMemberManagement,
    });

  // Check account authority before reporting trusted-local capability availability.
  const authorizeMemberMutation = ({
    req,
    reply,
    accountId,
    action,
    options,
  }: AuthorizeMemberMutationInput): boolean => {
    if (!authorize({ req, reply, accountId, action, options })) return false;
    if (authMode === "off") {
      rejectTrustedLocalMemberMutation(reply);
      return false;
    }
    return true;
  };

  // Shared by reset-password and revoke-sessions below: both need the target's membership row,
  // including inactive ones, before doing security-sensitive work. includeInactive: an existence
  // probe, not an authorization one (that is the port's job just below). An admin disables a
  // compromised account first and rotates its password / kills its sessions second, so an
  // active-only probe here would 404 exactly the case these routes exist for.
  const requireMembership = async ({ reply, accountId, userId, command }: RequireMembershipInput) => {
    const membership = await accountAdminPort.getMembership({
      principalId: userId,
      workspaceId: accountId,
      includeInactive: true,
    });
    if (!membership) accountFail(reply, createMemberNotFoundError(command));
    return membership;
  };
  return {
    isKnownRole,
    validationFailed: createValidationFailure,
    memberNotFound: createMemberNotFoundError,
    auditUnlessReplayed,
    rejectTrustedLocalMemberMutation,
    authorizeMemberMutation,
    requireMembership,
  };
}

/**
 * Combines account route dependencies with the reply helpers available to account handlers.
 */
export type AccountRouteContext = AccountRouteDependencies & AccountReplyHelpers;
