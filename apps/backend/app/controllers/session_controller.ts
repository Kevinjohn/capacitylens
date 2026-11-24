import { inject } from '@adonisjs/core';
import { AdmissionMembershipService } from '#services/membership/admission_membership_service';
import type { HttpContext } from '@adonisjs/core/http';
import db from '@adonisjs/lucid/services/db';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import {
  InvalidCredentialsError,
  InvalidSessionError,
} from '@kevinjohn/adonisjs-account-kit/errors';
import type { CurrentAccountInput } from '@kevinjohn/adonisjs-account-kit/types';
import { isMailConfigured } from '#services/mail_delivery';
import { isFirstCompanySetupRequired } from '#services/first_company_setup';
import { signInWithPassword } from '#services/auth/password_sign_in';
import { buildUserProjection } from '#services/auth/user_projection';
import { requireAdmissionDecision, withActor } from '#services/auth/current_actor';
import { signInValidator } from '#validators/auth_requests';
import { hasAnyIdentity } from '#services/installation_company';

/** The caller's sign-in: who is signed in, signing in with a password, and signing out. */
@inject()
export default class SessionController {
  #admissionMemberships: AdmissionMembershipService;

  constructor(admissionMemberships: AdmissionMembershipService) {
    this.#admissionMemberships = admissionMemberships;
  }

  /**
   * The signed-in identity and what it may reach: a confirmed address, admission, company setup
   * and membership decide between the limited screens and the schedule.
   */
  async show({ auth, response, serialize }: HttpContext) {
    try {
      return serialize(
        await withActor(
          auth,
          async (actor, trx) => {
            const admission = await requireAdmissionDecision(actor.userId, trx);
            const admitted = actor.emailVerified && admission.admitted;
            return {
              user: buildUserProjection(actor),
              emailVerified: actor.emailVerified,
              admission,
              companySetupRequired:
                admitted && (await isFirstCompanySetupRequired(actor.userId, trx)),
              // Admitted but not yet a member: the person completes their membership explicitly.
              membershipRequired:
                admitted &&
                (await this.#admissionMemberships.isMembershipRequired(actor.userId, trx)),
            };
          },
          { limited: true }
        )
      );
    } catch (error) {
      // Does work: a missing session reads whether any identity exists for the 401 body.
      if (!(error instanceof InvalidSessionError)) throw error;
      const hasUsers = await hasAnyIdentity(db);
      return response.unauthorized({
        error: 'Sign-in required.',
        code: 'SIGN_IN_REQUIRED',
        passwordResetEmail: isMailConfigured(),
        ...(!hasUsers ? { needsSetup: true } : {}),
      });
    }
  }

  async store({ auth, request, response, logger, serialize }: HttpContext) {
    const body = await request.validateUsing(signInValidator, { data: request.body() });
    const { email } = body;
    try {
      const user = await signInWithPassword(auth, logger, {
        email,
        password: body.password,
        clientAddress: request.ip(),
        userAgent: request.header('user-agent'),
      });
      return serialize({ user });
    } catch (error) {
      // Keeps the 401 without a code and the actionable sentence: the Kit's code for this failure
      // is one the browser's error reader does not list, and its sentence names nothing to fix.
      if (error instanceof InvalidCredentialsError) {
        return response.unauthorized({ error: 'Invalid email or password.' });
      }
      throw error;
    }
  }

  /** Ends this sign-in while leaving the identity-wide view active in its other sessions. */
  async destroy({ auth, session, serialize }: HttpContext) {
    const guard = auth.use('web');
    const request = guard.forRequest();
    let current: CurrentAccountInput | undefined;
    try {
      current = await guard.current();
    } catch (error) {
      // Does work: signing out without a session is a normal outcome, not a refusal.
      if (!(error instanceof InvalidSessionError)) throw error;
      // Does work: an idle-expired sign-in fails `current` but still names its own registry row.
      const userId: unknown = session.get(guard.sessionKeyName);
      const sessionHandle = request.strategy === 'session' ? request.previousHandle?.() : undefined;
      if ((typeof userId === 'string' || typeof userId === 'number') && sessionHandle) {
        current = { userId, sessionHandle };
      }
    }
    await accountKit.authentication.logout(request, undefined, current);
    return serialize({ ok: true });
  }
}
