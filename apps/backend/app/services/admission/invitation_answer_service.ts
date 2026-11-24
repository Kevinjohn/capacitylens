import type { HttpContext } from '@adonisjs/core/http';
import type { Invitation } from '@kevinjohn/adonisjs-account-kit/types';
import { assertCompanyPermission } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { getInstallationCompanyId } from '#services/installation_company';
import { refuseInvalidAdmission, refuseMissingAdmission } from '#exceptions/admission_errors';

/** The checks and shapes the invitation controllers share. */
export class InvitationAnswerService {
  /** Reads an invitation route's id, or `null` when it is not a positive safe integer. */
  parseInvitationId(value: unknown) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  /** The invitation fields a manager sees. */
  buildInvitationView(invitation: Invitation) {
    return {
      id: invitation.id,
      role: invitation.role,
      preauthEmail: invitation.email,
      expiresAt: invitation.expiresAt.toISO(),
      createdAt: invitation.createdAt.toISO(),
    };
  }

  /** The 503 body answered when invitations cannot be emailed. */
  buildMailUnavailableBody() {
    return {
      error: 'Invitations need email delivery. Ask your administrator to configure mail.',
      code: 'MAIL_UNAVAILABLE',
    };
  }

  /** Confirms the caller manages invitations for this installation's company. */
  async requireInvitationManager(auth: HttpContext['auth'], companyId: unknown) {
    if (typeof companyId !== 'string' || !companyId) refuseInvalidAdmission();
    return withActor(auth, async (_actor, trx) => {
      const { actorId } = await assertCompanyPermission(companyId, 'invitations:manage', trx);
      if ((await getInstallationCompanyId(trx)) !== companyId) {
        refuseMissingAdmission('Company not found.');
      }
      return actorId;
    });
  }
}
