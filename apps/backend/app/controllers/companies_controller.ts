import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import access from '#config/access_control';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { hasMultipleCompanies } from '#services/installation_company';
import { buildAccessGrant } from '#services/auth/access_grant';
import { isRole } from '@capacitylens/shared/account/types';
import CompanySummaryTransformer from '#transformers/company_summary_transformer';

/** Returns the companies this user may enter, or 409 while the installation has more than one. */
@inject()
export default class CompaniesController {
  #currentActor: CurrentActorService;

  constructor(currentActor: CurrentActorService) {
    this.#currentActor = currentActor;
  }

  async index({ auth, response, serialize }: HttpContext) {
    const summaries = await this.#currentActor.withActor(auth, async (actor, trx) => {
      if (await hasMultipleCompanies(trx)) return null;
      const rows = await trx
        .from(`${access.config.membershipsTable} as member`)
        .innerJoin('companies as company', 'company.id', 'member.scope_id')
        .where({ 'member.user_id': actor.userId, 'member.status': 'active' })
        .select('company.id', 'company.name', 'member.role');
      return rows
        .sort((left, right) => String(left.name).localeCompare(String(right.name)))
        .map((row) => ({
          id: row.id,
          name: row.name,
          role: row.role,
          ...(isRole(row.role)
            ? buildAccessGrant(row.role, false)
            : { permissions: [], canSeePrivateNames: false, canSeeTimeOffNote: false }),
        }));
    });
    if (summaries === null) {
      return response.conflict({
        error:
          'This installation has more than one company. Contact the administrator to resolve it.',
        code: 'MULTIPLE_COMPANIES',
      });
    }
    return serialize(CompanySummaryTransformer.transform(summaries));
  }
}
