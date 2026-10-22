import type { InvitationRole } from "@capacitylens/shared/account/types";

/** Fields sent when creating a workspace invitation. */
export interface CreateInvitationBody {
  accountId: string;
  role: InvitationRole;
  preauthEmail?: string;
  proposedResourceId?: string;
}

/** Credentials and invitation details submitted when accepting an invitation. */
export interface InvitationSignupBody {
  name: string;
  email: string;
  password: string;
}
