// One router middleware applies each route's account gate by its name before the handler runs,
// using Account Kit's managed guard. A route name in no list gets the strictest check; only the
// health probes and the application shell have no name. Routes under `/api/auth` are public at the
// gate because their handlers answer a signed-out caller themselves.

import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
import app from '@adonisjs/core/services/app';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { AccountAdmission, admissionMiddleware } from '@kevinjohn/adonisjs-account-kit/admission';
import { InvalidSessionError } from '@kevinjohn/adonisjs-account-kit/errors';
import { managedAccountMiddleware } from '@kevinjohn/adonisjs-account-kit/http';
import { managedGuard } from '#services/auth/managed_guard';
import { routeAccess } from '#services/auth/route_access';
import { sendRefusal } from '#services/planning/http_refusal';

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
 * Account Kit checks the sign-in, and admission on product routes, before the handler runs. The
 * route's name selects the check. Handlers still verify the actor inside their own transaction.
 */
export default class AccountGateMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const access = routeAccess(ctx.route?.name);
    if (access !== 'public') {
      try {
        // The check runs alone, so a refusal raised later by the handler is not mistaken for it.
        await checks[access](ctx, async () => undefined);
      } catch (error) {
        if (error instanceof InvalidSessionError) {
          return ctx.response.unauthorized({
            error: 'Sign-in required.',
            code: 'SIGN_IN_REQUIRED',
          });
        }
        // Planning handlers answer a refusal in their own wording; the gate keeps that body.
        if (ctx.route?.name?.startsWith('api.planning.')) return sendRefusal(error, ctx);
        throw error;
      }
    }
    return next();
  }
}
