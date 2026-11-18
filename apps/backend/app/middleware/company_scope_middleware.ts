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
 * in `:companyId`; under view-as that user is the viewed-as member. Every route with `:companyId`
 * in its path runs the Access Control package's `scope` middleware through this one, after
 * authentication. The refusal matches what the handler's own check answers: the package's
 * `memberships.authorize` inside the product transaction, which still runs and is the only check
 * on a route that takes the company id from the body.
 */
export default class CompanyScopeMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { planning?: boolean } = {}) {
    try {
      await scope.handle(ctx, async () => undefined, {
        resolveScope: (request) => request.params.companyId,
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
