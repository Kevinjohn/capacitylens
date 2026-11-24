import app from '@adonisjs/core/services/app';
import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { InvalidCredentialsError, ThrottledError } from '@kevinjohn/adonisjs-account-kit/errors';
import capacitylens from '#config/capacitylens';
import { withActor } from '#services/auth/current_actor';
import { MemberSignInTrackingService } from '#services/membership/member_sign_in_tracking_service';
import { buildUserProjection } from '#services/auth/user_projection';

function logSignInOutcome(
  logger: HttpContext['logger'],
  outcome: 'success' | 'failure' | 'throttled'
) {
  if (!capacitylens.requestLogging) return;
  try {
    const fields = { event: 'auth.sign_in', outcome };
    if (outcome === 'failure' || outcome === 'throttled') {
      logger.warn(fields, 'Authentication outcome');
    } else {
      logger.info(fields, 'Authentication outcome');
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

/** Signs in through Account Kit and records the observed sign-in for tracked companies. */
export async function signInWithPassword(
  auth: HttpContext['auth'],
  logger: HttpContext['logger'],
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
      auth.use('web').forRequest()
    );
  } catch (error) {
    // Record expected credential refusals, then preserve the original package failure.
    if (error instanceof InvalidCredentialsError) logSignInOutcome(logger, 'failure');
    if (error instanceof ThrottledError) logSignInOutcome(logger, 'throttled');
    throw error;
  }
  logSignInOutcome(logger, 'success');
  return withActor(
    auth,
    async (actor, trx) => {
      const signInTracking = await app.container.make(MemberSignInTrackingService);
      await signInTracking.recordSignIn(actor.userId, trx);
      return buildUserProjection(actor);
    },
    { limited: true }
  );
}
