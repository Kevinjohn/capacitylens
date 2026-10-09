import type { InvitationRole, MembershipStatus } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";

export interface TeamMember {
  userId: string;
  role: Role;
  status: MembershipStatus;
  accessDisabled?: boolean;
  membershipPresent?: boolean;
  createdAt: string;
  name: string | null;
  email: string | null;
  /** Coarse, account-opted-in observation. Null means tracking is off; no timestamp is collected. */
  signInConfirmed: boolean | null;
  isSelf: boolean;
  mayResetPassword: boolean;
  mayRevokeSessions: boolean;
  resourceLink?: {
    resourceId: string;
    revision: string;
    resourceName?: string | null;
    resourceStatus?: "active" | "disabled" | "archived" | null;
  } | null;
  resourceLinkException?: {
    proposedResourceId: string | null;
    reason: "resource_unavailable" | "resource_already_linked" | "member_already_linked";
  } | null;
}

export interface TeamDirectory {
  members: TeamMember[];
  signInTrackingEnabled: boolean;
  resourceCandidates: { resourceId: string; label: string }[];
}

export interface TeamInvitation {
  id: string;
  role: InvitationRole;
  preauthEmail: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  proposedResourceId?: string;
  proposedResourceLabel?: string;
}

export interface OneTimeToken {
  emailed?: boolean;
  id?: string;
  token: string;
  expiresAt?: string;
}
