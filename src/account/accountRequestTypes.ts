import type { InvitationRole } from "@capacitylens/shared/account/types";
import type { Account } from "@capacitylens/shared/types/entities";

/** Fields accepted when creating a workspace; the name is required and preferences are optional. */
export type CreateWorkspaceBody = Pick<Account, "name"> &
  Partial<
    Pick<Account, "color" | "weekStartsOn" | "timezone" | "language" | "schedulingMode" | "inlineActivityCreateEnabled">
  >;

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
