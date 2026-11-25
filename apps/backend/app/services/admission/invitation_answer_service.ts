import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import type { Invitation } from '@kevinjohn/adonisjs-account-kit/types';
import { AuthorizationService } from '#services/auth/authorization_service';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { refuseMissingAdmission } from '#exceptions/admission_errors';
import { InstallationCompanyService } from '#services/installation_company_service';

/** The checks and shapes the invitation controllers share. */
@inject()
export class InvitationAnswerService {
  #authorization: AuthorizationService;
  #currentActor: CurrentActorService;
  #installationCompany: InstallationCompanyService;

  constructor(
    authorization: AuthorizationService,
    currentActor: CurrentActorService,
    installationCompany: InstallationCompanyService
  ) {
    this.#authorization = authorization;
    this.#currentActor = currentActor;
    this.#installationCompany = installationCompany;
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
  async requireInvitationManager(auth: HttpContext['auth'], companyId: string) {
    return this.#currentActor.withActor(auth, async (_actor, trx) => {
      const { actorId } = await this.#authorization.assertCompanyPermission(
        companyId,
        'invitations:manage',
        trx
      );
      if ((await this.#installationCompany.getInstallationCompanyId(trx)) !== companyId) {
        refuseMissingAdmission('Company not found.');
      }
      return actorId;
    });
  }
}
