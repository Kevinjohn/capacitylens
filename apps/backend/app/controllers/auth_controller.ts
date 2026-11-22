import type { HttpContext } from '@adonisjs/core/http';
import db from '@adonisjs/lucid/services/db';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import {
  InvalidCredentialsError,
  InvalidSessionError,
  RegistrationEmailAlreadyRegisteredError,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors';
import type { CurrentAccountInput } from '@kevinjohn/adonisjs-account-kit/types';
import capacitylens from '#config/capacitylens';
import { isMailConfigured } from '#services/mail_delivery';
import { FirstCompanyPendingException } from '#exceptions/first_company_pending_exception';
import { isFirstCompanySetupRequired } from '#services/first_company_setup';
import { isMembershipRequired } from '#services/membership/admission_membership';
import { signInWithPassword } from '#services/auth/password_sign_in';
import { buildUserProjection } from '#services/auth/user_projection';
import { requireAdmissionDecision, withActor } from '#services/auth/current_actor';
import { errors as vineErrors } from '@vinejs/vine';
import { signInValidator, signUpValidator } from '#validators/auth_requests';
import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import { hasAnyIdentity, hasNoCompany } from '#services/installation_company';
import { managedGuard } from '#services/auth/managed_guard';

function requireAuthRequestMessage(error: unknown, operation: 'sign-in' | 'sign-up') {
  if (!(error instanceof vineErrors.E_VALIDATION_ERROR)) throw error;
  const shape = error.messages.some(
    (message: { rule: string }) => message.rule === 'unknownField' || message.rule === 'object'
  );
  return shape
    ? `Invalid ${operation} request.`
    : operation === 'sign-in'
      ? 'Invalid email or password.'
      : 'Invalid sign-up details.';
}

export default class AuthController {
  /**
   * The signed-in identity and what it may reach: a confirmed address, admission, company setup
   * and membership decide between the limited screens and the schedule.
   */
  async me(ctx: HttpContext) {
    try {
      return await withActor(
        ctx,
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
            membershipRequired: admitted && (await isMembershipRequired(actor.userId, trx)),
          };
        },
        { limited: true }
      );
    } catch (error) {
      // Does work: a missing session reads whether any identity exists for the 401 body.
      if (!(error instanceof InvalidSessionError)) throw error;
      const hasUsers = await hasAnyIdentity(db);
      return ctx.response.unauthorized({
        error: 'Sign-in required.',
        code: 'SIGN_IN_REQUIRED',
        passwordResetEmail: isMailConfigured(),
        ...(!hasUsers ? { needsSetup: true } : {}),
      });
    }
  }

  async signIn(ctx: HttpContext) {
    const [validationError, body] = await ctx.request.tryValidateUsing(signInValidator, {
      data: ctx.request.body(),
    });
    // Route wording: sign-in answers a Vine failure with its own sentence and no code.
    if (validationError) {
      return ctx.response.badRequest({
        error: requireAuthRequestMessage(validationError, 'sign-in'),
      });
    }
    const { email } = body;
    try {
      const user = await signInWithPassword(ctx, {
        email,
        password: body.password,
        clientAddress: ctx.request.ip(),
        userAgent: ctx.request.header('user-agent'),
      });
      return ctx.response.ok({ user });
    } catch (error) {
      // Route wording: sign-in names a credential failure; the handler sends the Kit's generic one.
      if (error instanceof InvalidCredentialsError) {
        return ctx.response.unauthorized({ error: 'Invalid email or password.' });
      }
      throw error;
    }
  }

  /**
   * Open registration, when the operator enables it, creates a limited identity that still needs
   * a confirmed address and admission. The first identity always comes from the bootstrap invitation.
   */
  async signUp(ctx: HttpContext) {
    const [validationError, body] = await ctx.request.tryValidateUsing(signUpValidator, {
      data: ctx.request.body(),
    });
    // Route wording: sign-up answers a Vine failure with its own sentence and no code.
    if (validationError) {
      return ctx.response.badRequest({
        error: requireAuthRequestMessage(validationError, 'sign-up'),
      });
    }
    const { email, name } = body;
    if (!capacitylens.allowOpenSignUp || (await hasNoCompany(db))) {
      return ctx.response.forbidden({ error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' });
    }
    try {
      await accountKit.registration.register({
        email,
        password: body.password,
        registrationData: { name },
      });
    } catch (error) {
      // Route wording: sign-up words these refusals for this route; invitations word them
      // differently.
      if (error instanceof FirstCompanyPendingException) {
        return ctx.response.forbidden({ error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' });
      }
      if (error instanceof RegistrationEmailAlreadyRegisteredError) {
        return ctx.response.conflict({
          error: 'An account already uses this email. Sign in or reset your password.',
          code: 'EMAIL_REGISTERED',
        } satisfies ProductHttpErrorBody);
      }
      // The account exists; only the confirmation email may be missing, and it can be resent.
      if (!isCommittedFailure(error)) throw error;
      ctx.logger.warn({ code: 'REGISTRATION_FOLLOW_UP_FAILED' }, 'Registration follow-up failed');
    }
    try {
      return ctx.response.created({
        user: await signInWithPassword(ctx, {
          email,
          password: body.password,
          clientAddress: ctx.request.ip(),
          userAgent: ctx.request.header('user-agent'),
        }),
      });
    } catch (error) {
      // Does work: the account exists, so a failed sign-in is logged and answered as sign-in
      // required.
      ctx.logger.warn(
        { code: error instanceof Error ? error.name : 'UNKNOWN' },
        'Sign-in after registration failed'
      );
      return ctx.response.accepted({ accountCreated: true, signInRequired: true });
    }
  }

  /** Ends this sign-in while leaving the identity-wide view active in its other sessions. */
  async signOut(ctx: HttpContext) {
    let current: CurrentAccountInput | undefined;
    try {
      current = await managedGuard.current(ctx);
    } catch (error) {
      // Does work: signing out without a session is a normal outcome, not a refusal.
      if (!(error instanceof InvalidSessionError)) throw error;
    }
    await accountKit.authentication.logout(managedGuard.forRequest(ctx), undefined, current);
    return ctx.response.ok({ ok: true });
  }
}
