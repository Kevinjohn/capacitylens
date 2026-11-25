import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import db from '@adonisjs/lucid/services/db';
import { getInstallationCompany } from '#services/installation_company';
import { invalidLinkAnswer } from '#exceptions/credential_answers';
import { showInvitationLinkValidator } from '#validators/invitations';
import { requestData } from '#validators/request_rules';

/** What an invitation link offers. */
export default class InvitationLinksController {
  /** What the link offers, without spending it. */
  async show({ request, response, serialize }: HttpContext) {
    const { params } = await request.validateUsing(showInvitationLinkValidator, {
      data: requestData(request),
    });
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
