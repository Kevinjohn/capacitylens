import type { MailSender } from "../../authConfig/mailSender";
import type { AuthorizeRouteInput } from "../../routes/routeShared";
import type {
  AccountAdminPort,
  AccountFlows,
  AccountMemberResourcePort,
  IdentityPort,
} from "@capacitylens/shared/account/ports";
import type {
  AccountMode,
  CommandIdentity,
  IdentityAdminAction,
  IdentityAdminAuthorityDecision,
} from "@capacitylens/shared/account/types";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditRecord } from "../../audit";
import type { SetMemberSignInTrackingInput, MemberSignInTrackingSnapshot } from "../memberSignInTracking";

/** Route generics for the account-administration paths; Fastify path parameters are strings. */
export interface AccountRoute {
  Params: { accountId: string };
}

export interface MemberRoute {
  Params: { accountId: string; userId: string };
}

export interface InvitationTokenRoute {
  Params: { token: string };
}

export interface InvitationRoute {
  Params: { accountId: string; id: string };
}

export interface OwnershipTransferRequestRoute {
  Params: { accountId: string; requestId: string };
}

export interface SessionRoute {
  Params: { sessionId: string };
}

export const MEMBER_SIGN_IN_TRACKING_RATE_LIMIT = {
  max: 5,
  timeWindow: "1 minute",
  groupId: "member-sign-in-tracking",
} as const;

type SetMemberSignInTrackingRequestInput = Omit<SetMemberSignInTrackingInput, "db" | "accountId"> & {
  workspaceId: string;
};

export interface AccountRouteDependencies {
  memberResources: AccountMemberResourcePort;
  authMode: AccountMode;
  authenticationConfigured: boolean;
  invitationMail: { sender: MailSender; publicUrl: URL } | null;
  /** SSO-only invitation acceptance must arrive through this provider so a new membership cannot
   * make the installation fail its next strict-provider readiness check. */
  requiredSsoProviderId: string | null;
  permittedCompanyProviderIds?: ReadonlySet<string>;
  administration: AccountAdminPort;
  identity: IdentityPort;
  flows: AccountFlows;
  memberSignInTracking: {
    snapshot(workspaceId: string): MemberSignInTrackingSnapshot;
    set(input: SetMemberSignInTrackingRequestInput): { enabled: boolean; changed: boolean };
  };
  authorize(input: AuthorizeRouteInput): boolean;
  /** Is this request being made through an active masquerade? The global policy already refuses
   * every unsafe method, so only reads that must conceal rather than redact consult this. */
  isMasquerading(req: FastifyRequest): boolean;
  command(req: FastifyRequest): CommandIdentity;
  audit(reply: FastifyReply, record: AuditRecord): void;
  fail(reply: FastifyReply, error: unknown): unknown;
  memberReadProjection(
    req: FastifyRequest,
    workspaceId: string,
    targetPrincipalIds: readonly string[],
  ): {
    principalId: string;
    decisions: ReadonlyMap<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>;
  };
}
