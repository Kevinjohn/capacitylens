import type { InvitationRole } from '@capacitylens/shared/account/types';

/** Fields sent when creating a workspace invitation. */
export interface CreateInvitationBody {
  accountId: string;
  role: InvitationRole;
  email: string;
}

/** The name and password an invitee chooses; the invitation fixes the address. */
export interface InvitationSignupBody {
  name: string;
  password: string;
}
