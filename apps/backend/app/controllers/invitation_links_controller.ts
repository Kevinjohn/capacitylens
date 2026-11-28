import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import { invalidLinkAnswer } from '#services/errors/credential_answers'
import { InstallationCompanyService } from '#services/installation_company_service'
import { showInvitationLinkValidator } from '#validators/invitation'

/** What an invitation link offers. */
@inject()
export default class InvitationLinksController {
  #installationCompany: InstallationCompanyService

  constructor(installationCompany: InstallationCompanyService) {
    this.#installationCompany = installationCompany
  }

  /** What the link offers, without spending it. */
  async show({ request, response, serialize }: HttpContext) {
    const { params } = await request.validateUsing(showInvitationLinkValidator)
    const invitation = await accountKit.invitations.inspect({ token: params.token })
    if (!invitation) return response.notFound(invalidLinkAnswer)
    const { companyId, companyName } = await this.#installationCompany.getInstallationCompany()
    return serialize({
      companyId,
      companyName,
      // Before the company exists the role is only bootstrap metadata; setup grants Owner.
      role: companyId ? invitation.role : null,
      email: invitation.email,
    })
  }
}
