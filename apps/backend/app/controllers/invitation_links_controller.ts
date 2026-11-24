import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import db from '@adonisjs/lucid/services/db';
import { setProofHeaders } from '#services/request_helpers';
import { getInstallationCompany } from '#services/installation_company';
import { invalidLinkAnswer } from '#exceptions/credential_answers';

/** What an invitation link offers. */
export default class InvitationLinksController {
  /** What the link offers, without spending it. */
  async show({ params, response, serialize }: HttpContext) {
    setProofHeaders(response);
    const invitation = await accountKit.invitations.inspect({ token: params.token });
    if (!invitation) return response.notFound(invalidLinkAnswer);
    const { companyId, companyName } = await getInstallationCompany(db);
    return serialize({
      companyId,
      companyName,
      // Before the company exists the role is only bootstrap metadata; setup grants Owner.
      role: companyId ? invitation.role : null,
      email: invitation.email,
    });
  }
}
