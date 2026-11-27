import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
import app from '@adonisjs/core/services/app';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { AccountAdmission, admissionMiddleware } from '@kevinjohn/adonisjs-account-kit/admission';
import { E_ACCOUNT_KIT_INVALID_SESSION } from '@kevinjohn/adonisjs-account-kit/errors';
import { managedAccountMiddleware } from '@kevinjohn/adonisjs-account-kit/http';
import { managedGuard } from '#services/auth/managed_guard';

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

/** What the gate asks of a route: `limited` needs a valid sign-in; `admitted` also needs admission. */
export type GatedRouteAccess = 'limited' | 'admitted';

/**
 * Applies a route's account gate before the handler runs: Account Kit's managed guard checks the
 * sign-in, and admission on product routes. The route's group, or the route itself, names the check
 * with the `access` option; a route without the gate is public, and its handler answers a signed-out
 * caller itself. Handlers still verify the actor inside their own transaction.
 */
export default class AccountGateMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { access: GatedRouteAccess }) {
    try {
      // The check runs alone, so a refusal raised later by the handler is not mistaken for it.
      await checks[options.access](ctx, async () => undefined);
    } catch (error) {
      // Keeps `E_SIGN_IN_REQUIRED`, which the browser reads, where the handler sends the Kit's own
      // code; every other refusal reaches the handler.
      if (error instanceof E_ACCOUNT_KIT_INVALID_SESSION) {
        return ctx.response.unauthorized({
          error: 'Sign-in required.',
          code: 'E_SIGN_IN_REQUIRED',
        });
      }
      throw error;
    }
    return next();
  }
}
