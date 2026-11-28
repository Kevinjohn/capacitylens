import type { Route } from '@capacitylens/backend/registry'

/** Fields sent when creating a company invitation. */
export type CreateInvitationBody = Route.Body<'api.invitations.store'>

/** The name and password an invitee chooses; the invitation fixes the address. */
export type InvitationSignUpBody = Route.Body<'api.invitation_acceptances.store'>
