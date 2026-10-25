import type { InvitationRole, MembershipStatus } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";

/** A workspace member and the resource-link state shown in team access. */
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
  resourceLink?: {
    resourceId: string;
    revision: string;
    resourceName?: string | null;
    resourceStatus?: "active" | "disabled" | "archived" | null;
  } | null;
}

/** Members, sign-in tracking state, and resource candidates for a workspace. */
export interface TeamDirectory {
  members: TeamMember[];
  signInTrackingEnabled: boolean;
  resourceCandidates: { resourceId: string; label: string }[];
}

/** A pending invitation for one address. */
export interface TeamInvitation {
  id: string;
  role: InvitationRole;
  preauthEmail: string;
  expiresAt: string;
  createdAt: string;
}

/** A signed-in person waiting for an Owner or Admin to approve their access. */
export interface AdmissionRequest {
  userId: string;
  email: string;
  requestedAt: string | null;
  /** The role an invitation offered, which completion grants when it is assignable. */
  invitedRole: string | null;
}
