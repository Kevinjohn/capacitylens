import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { addExampleData } from '#services/example_data';
import { EntityWriteError } from '#services/planning/errors';
import { assertCompanyAction } from '#services/auth/authorization';

export default class ExampleDataController {
  async store(ctx: HttpContext) {
    const { params, response, logger } = ctx;
    const accountId = params.accountId;
    try {
      const added = await withActor(ctx, async (_actor, trx) => {
        const actor = await assertCompanyAction(accountId, 'members:manage', trx);
        return addExampleData(trx, accountId, actor.actorId);
      });
      try {
        logger.info({ accountId, added }, 'Example data committed');
      } catch {
        // The audit and data are already committed; logging is diagnostic only.
      }
      return response.created({ added });
    } catch (error) {
      if (error instanceof EntityWriteError) {
        return response.status(error.status).send({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
      }
      throw error;
    }
  }
}
