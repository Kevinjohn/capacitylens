import type { HttpContext } from '@adonisjs/core/http';
import accountKit from 'adonisjs-account-kit/services/main';
import { InvalidCredentialsError, ThrottledError } from 'adonisjs-account-kit/errors';
import env from '#start/env';
import { sessionGuard, withActor } from '#services/auth/current_actor';
import { recordMemberSignIn } from '#services/membership/sign_in_tracking';
import { buildUserProjection } from '#services/auth/user_projection';

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

/** Signs in through Account Kit and records the observed sign-in for tracked companies. */
export async function signInWithPassword(ctx: HttpContext, email: string, password: string) {
  try {
    await accountKit.authentication.login(
      {
        email,
        password,
        clientKey: ctx.request.ip(),
        sessionLabel: ctx.request.header('user-agent')?.slice(0, 200),
      },
      sessionGuard(ctx)
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
