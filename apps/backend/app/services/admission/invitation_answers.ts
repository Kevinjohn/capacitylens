import type { HttpContext } from '@adonisjs/core/http';
import type { Invitation } from '@kevinjohn/adonisjs-account-kit/types';
import { assertCompanyPermission } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { getInstallationCompanyId } from '#services/installation_company';
import { refuseInvalidAdmission, refuseMissingAdmission } from '#services/admission/errors';

/** Reads an invitation route's id, or `null` when it is not a positive safe integer. */
export function parseInvitationId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The invitation fields a manager sees. */
export function buildInvitationView(invitation: Invitation) {
  return {
    id: invitation.id,
    role: invitation.role,
    preauthEmail: invitation.email,
    expiresAt: invitation.expiresAt.toISO(),
    createdAt: invitation.createdAt.toISO(),
  };
}

/** The refusal for an invitation link that is invalid or has expired. */
export const invalidInvitationLink = {
  error: 'This invitation is invalid or has expired.',
  code: 'INVALID_TOKEN',
};

/** Answers 503 when invitations cannot be emailed. */
export function answerMailUnavailable(response: HttpContext['response']) {
  return response.serviceUnavailable({
    error: 'Invitations need email delivery. Ask your administrator to configure mail.',
    code: 'MAIL_UNAVAILABLE',
  });
}

/** Confirms the caller manages invitations for this installation's company. */
export async function requireInvitationManager(ctx: HttpContext, companyId: unknown) {
  if (typeof companyId !== 'string' || !companyId) refuseInvalidAdmission();
  return withActor(ctx, async (_actor, trx) => {
    const { actorId } = await assertCompanyPermission(companyId, 'invitations:manage', trx);
    if ((await getInstallationCompanyId(trx)) !== companyId) {
      refuseMissingAdmission('Company not found.');
    }
    return actorId;
  });
}
