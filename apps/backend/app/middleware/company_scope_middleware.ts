import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
import { AccessControlError } from '@kevinjohn/adonisjs-access-control';
import ScopeMiddleware from '@kevinjohn/adonisjs-access-control/middleware';
import { IdentityAuthorityError } from '#services/auth/authorization';
import { PlanningOperationError } from '#services/planning/execute';
import { sendRefusal } from '#services/planning/http_refusal';

const scope = new ScopeMiddleware();

/**
 * Refuses a company route before its handler unless the route's user holds an active membership
 * in `:accountId`; under view-as that user is the viewed-as member. The refusal matches what the
 * handler's own check answers, which still runs inside the product transaction.
 */
export default class CompanyScopeMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { planning?: boolean } = {}) {
    try {
      await scope.handle(ctx, async () => undefined, {
        resolveScope: (request) => request.params.accountId,
      });
    } catch (error) {
      if (!(error instanceof AccessControlError) || error.code !== 'E_ACCESS_CONTROL_FORBIDDEN') {
        throw error;
      }
      if (!options.planning) throw new IdentityAuthorityError('Forbidden.');
      return sendRefusal(
        new PlanningOperationError(
          403,
          'ACCOUNT_MEMBERSHIP_LOST',
          'Company membership is unavailable.'
        ),
        ctx
      );
    }
    return next();
  }
}
