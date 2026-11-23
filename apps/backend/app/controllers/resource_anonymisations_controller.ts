import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { anonymiseResources } from '#services/anonymise';
import { anonymiseResourceValidator } from '#validators/anonymise';
import { assertCompanyPermission } from '#services/auth/authorization';

/** Anonymises one person. */
export default class ResourceAnonymisationsController {
  async store({ auth, params, request, response }: HttpContext) {
    await request.validateUsing(anonymiseResourceValidator, { data: request.body() });
    const { companyId, id } = params;
    const applied = await withActor(auth, async (actor, trx) => {
      if (actor.masqueradeContext?.isMasquerading) return 'forbidden';
      await assertCompanyPermission(companyId, 'resources:anonymise', trx);
      return anonymiseResources(trx, companyId, actor.userId, id);
    });
    if (applied === 'forbidden') return response.forbidden({ error: 'Forbidden.' });
    if (!applied) return response.notFound({ error: 'Not found.' });
    return response.noContent();
  }
}
