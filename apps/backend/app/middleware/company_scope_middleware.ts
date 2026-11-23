import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
import { AccessControlError } from '@kevinjohn/adonisjs-access-control';
import ScopeMiddleware from '@kevinjohn/adonisjs-access-control/middleware';
import { IdentityAuthorizationException } from '#exceptions/identity_authorization_exception';
import { membershipUnavailable } from '#exceptions/planning_operation_exception';

const scope = new ScopeMiddleware();

/**
 * Refuses a company route before its handler unless the route's user holds an active membership
 * in `:companyId`; under view-as that user is the viewed-as member. Every route with `:companyId`
 * in its path runs the Access Control package's `scope` middleware through this one, after
 * authentication. The refusal matches what the handler's own check answers: the package's
 * `memberships.authorize` inside the product transaction, which still runs and is the only check
 * on a route that takes the company id from the body.
 *
 * A planning route answers a missing membership with `ACCOUNT_MEMBERSHIP_LOST`, which the browser
 * reads to drop its planning projection; `membershipUnavailable` builds it, and the central mapper
 * knows no route.
 */
export default class CompanyScopeMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { planning?: boolean } = {}) {
    try {
      await scope.handle(ctx, async () => undefined, {
        resolveScope: (request) => request.params.companyId,
      });
    } catch (error) {
      // Translates the package's FORBIDDEN into the product's class; the handler answers it.
      if (!(error instanceof AccessControlError) || error.code !== 'E_ACCESS_CONTROL_FORBIDDEN') {
        throw error;
      }
      if (!options.planning) throw new IdentityAuthorizationException('Forbidden.');
      throw membershipUnavailable();
    }
    return next();
  }
}
