import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { addExampleData } from '#services/example_data';
import { assertCompanyAction } from '#services/auth/authorization';

export default class ExampleDataController {
  async store(ctx: HttpContext) {
    const { params, response, logger } = ctx;
    const companyId = params.companyId;
    const added = await withActor(ctx, async (_actor, trx) => {
      const actor = await assertCompanyAction(companyId, 'members:manage', trx);
      return addExampleData(trx, companyId, actor.actorId);
    });
    try {
      logger.info({ companyId, added }, 'Example data committed');
    } catch {
      // The audit and data are already committed; logging is diagnostic only.
    }
    return response.created({ added });
  }
}
