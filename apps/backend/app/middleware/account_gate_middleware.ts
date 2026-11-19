import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
import app from '@adonisjs/core/services/app';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { AccountAdmission, admissionMiddleware } from '@kevinjohn/adonisjs-account-kit/admission';
import { InvalidSessionError } from '@kevinjohn/adonisjs-account-kit/errors';
import { managedAccountMiddleware } from '@kevinjohn/adonisjs-account-kit/http';
import { managedGuard } from '#services/auth/managed_guard';
import { resolveRouteAccess } from '#services/auth/route_access';

const checks = {
  limited: managedAccountMiddleware({
    kit: async () => accountKit,
    guard: managedGuard,
    active: false,
  }),
  admitted: admissionMiddleware({
    admission: () => app.container.make(AccountAdmission),
    guard: managedGuard,
  }),
};

/**
 * Applies each route's account gate before the handler runs: Account Kit's managed guard checks the
 * sign-in, and admission on product routes. This one router middleware covers every route, and the
 * route's name selects the check. A route name in no list gets the strictest check; only the health
 * probes and the application shell have no name. Routes under `/api/auth` are public at the gate
 * because their handlers answer a signed-out caller themselves. Handlers still verify the actor
 * inside their own transaction.
 */
export default class AccountGateMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const access = resolveRouteAccess(ctx.route?.name);
    if (access !== 'public') {
      try {
        // The check runs alone, so a refusal raised later by the handler is not mistaken for it.
        await checks[access](ctx, async () => undefined);
      } catch (error) {
        // Route wording: the gate answers a missing session as SIGN_IN_REQUIRED, where the
        // handler sends the Kit's own code; every other refusal reaches the handler.
        if (error instanceof InvalidSessionError) {
          return ctx.response.unauthorized({
            error: 'Sign-in required.',
            code: 'SIGN_IN_REQUIRED',
          });
        }
        throw error;
      }
    }
    return next();
  }
}
