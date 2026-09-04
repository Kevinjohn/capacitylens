import type { AccountAdminPort, AccountFlows, IdentityPort } from "@capacitylens/shared/account/ports";
import type {
  AccountMode,
  CommandIdentity,
  IdentityAdminAction,
  IdentityAdminAuthorityDecision,
} from "@capacitylens/shared/account/types";
import type { Action } from "@capacitylens/shared/domain/access";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditRecord } from "../../audit";
import type { MemberSignInTrackingSnapshot } from "../memberSignInTracking";

// Shared by the two role-validation response paths below (AccountContractError and a direct 400) —
// same wording, deliberately different response shapes, so only the string is deduplicated.
export const INVALID_ROLE_MESSAGE = "role must be one of owner, admin, editor, viewer.";

export const MEMBER_SIGN_IN_TRACKING_RATE_LIMIT = {
  max: 5,
  timeWindow: "1 minute",
  groupId: "member-sign-in-tracking",
} as const;

export interface AccountRouteDependencies {
  authMode: AccountMode;
  authenticationConfigured: boolean;
  /** SSO-only invitation acceptance must arrive through this provider so a new membership cannot
   * make the installation fail its next strict-provider readiness check. */
  requiredSsoProviderId: string | null;
  administration: AccountAdminPort;
  identity: IdentityPort;
  flows: AccountFlows;
  memberSignInTracking: {
    snapshot(workspaceId: string): MemberSignInTrackingSnapshot;
    set(workspaceId: string, actorPrincipalId: string, enabled: boolean): { enabled: boolean; changed: boolean };
  };
  authorize(request: FastifyRequest, reply: FastifyReply, workspaceId: string, action: Action): boolean;
  command(request: FastifyRequest): CommandIdentity;
  audit(reply: FastifyReply, record: AuditRecord): void;
  fail(reply: FastifyReply, error: unknown): unknown;
  memberReadProjection(
    request: FastifyRequest,
    workspaceId: string,
    targetPrincipalIds: readonly string[],
  ): {
    principalId: string;
    decisions: ReadonlyMap<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>;
  };
}
