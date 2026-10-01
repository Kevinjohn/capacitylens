import type { InvitationRole } from "@capacitylens/shared/account/types";
import type { Account } from "@capacitylens/shared/types/entities";

export type CreateWorkspaceBody = Pick<Account, "name"> &
  Partial<
    Pick<
      Account,
      | "color"
      | "weekStartsOn"
      | "timezone"
      | "language"
      | "schedulingMode"
      | "inlineActivityCreateEnabled"
      | "internalColourMode"
    >
  >;

export interface CreateInvitationBody {
  accountId: string;
  role: InvitationRole;
  preauthEmail?: string;
  proposedResourceId?: string;
}

export interface InvitationSignupBody {
  name: string;
  email: string;
  password: string;
}
