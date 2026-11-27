import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
import { errors as accessControlErrors } from '@kevinjohn/adonisjs-access-control';
import ScopeMiddleware from '@kevinjohn/adonisjs-access-control/middleware';
import IdentityAuthorizationException from '#exceptions/identity_authorization_exception';
import MembershipLostException from '#exceptions/membership_lost_exception';

const scope = new ScopeMiddleware();

/**
 * Refuses a company route before its handler unless the route's user holds an active membership
 * in `:companyId`; under view-as that user is the viewed-as member. Every route with `:companyId`
 * in its path runs the Access Control package's `scope` middleware through this one, after
 * authentication. The refusal matches what the handler's own check answers: the package's
 * `memberships.authorize` inside the product transaction, which still runs and is the only check
 * on a route that takes the company id from the body.
 *
 * A planning route answers a missing membership with `E_ACCOUNT_MEMBERSHIP_LOST`, which the browser
 * reads to drop its planning projection; `MembershipLostException` carries it.
 */
export default class CompanyScopeMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { planning?: boolean } = {}) {
    try {
      await scope.handle(ctx, async () => undefined, {
        resolveScope: (request) => request.params.companyId,
      });
    } catch (error) {
      // Translates the package's `E_ACCESS_CONTROL_FORBIDDEN` into the product's class; the handler answers it.
      if (!(error instanceof accessControlErrors.E_ACCESS_CONTROL_FORBIDDEN)) {
        throw error;
      }
      if (!options.planning) throw new IdentityAuthorizationException();
      throw new MembershipLostException();
    }
    return next();
  }
}
