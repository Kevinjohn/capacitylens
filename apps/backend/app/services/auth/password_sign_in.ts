import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { InvalidCredentialsError, ThrottledError } from '@kevinjohn/adonisjs-account-kit/errors';
import env from '#start/env';
import { withActor } from '#services/auth/current_actor';
import { recordMemberSignIn } from '#services/membership/sign_in_tracking';
import { buildUserProjection } from '#services/auth/user_projection';
import { managedGuard } from '#services/auth/managed_guard';

function logSignInOutcome(ctx: HttpContext, outcome: 'success' | 'failure' | 'throttled') {
  if (env.get('CAPACITYLENS_LOG') !== '1') return;
  try {
    const fields = { event: 'auth.sign_in', outcome };
    if (outcome === 'failure' || outcome === 'throttled') {
      ctx.logger.warn(fields, 'Authentication outcome');
    } else {
      ctx.logger.info(fields, 'Authentication outcome');
    }
  } catch {
    // Logging must not change the authentication outcome or skip member tracking.
    console.error('Authentication outcome logging failed');
  }
}

/** The credentials and the request facts the controller read for one sign-in. */
export interface PasswordSignInInput {
  email: string;
  password: string;
  /** The client address, as trusted by the HTTP server's proxy settings. */
  clientAddress: string;
  userAgent: string | undefined;
}

/**
 * Signs in through Account Kit and records the observed sign-in for tracked companies. The context
 * is handed only to the packages bound to the request (the session guard and the actor helper).
 */
export async function signInWithPassword(
  ctx: HttpContext,
  { email, password, clientAddress, userAgent }: PasswordSignInInput
) {
  try {
    await accountKit.authentication.login(
      {
        email,
        password,
        clientKey: clientAddress,
        sessionLabel: userAgent?.slice(0, 200),
      },
      managedGuard.forRequest(ctx)
    );
  } catch (error) {
    // Record expected credential refusals, then preserve the original package failure.
    if (error instanceof InvalidCredentialsError) logSignInOutcome(ctx, 'failure');
    if (error instanceof ThrottledError) logSignInOutcome(ctx, 'throttled');
    throw error;
  }
  logSignInOutcome(ctx, 'success');
  return withActor(
    ctx,
    async (actor, trx) => {
      await recordMemberSignIn(actor.userId, trx);
      return buildUserProjection(actor);
    },
    { limited: true }
  );
}
