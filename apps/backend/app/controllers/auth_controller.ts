import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import accountKit from 'adonisjs-account-kit/services/main'
import {
  InvalidCredentialsError,
  InvalidSessionError,
  PostCommitError,
  RegistrationEmailAlreadyRegisteredError,
} from 'adonisjs-account-kit/errors'
import type { CurrentAccountInput } from 'adonisjs-account-kit/types'
import env from '#start/env'
import { FirstCompanyPendingError } from '#models/user'
import { requiresFirstCompanySetup } from '#services/first_company_setup'
import {
  accountInput,
  admissionDecision,
  sessionGuard,
  withActor,
  type CurrentActor,
} from '#services/auth/current_actor'
import { endMasqueradeForSignOut } from '#services/auth/masquerade'
import { recordMemberSignIn } from '#services/membership/sign_in_tracking'
import { passwordLengthFailure } from '@capacitylens/shared/domain/password'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import { MAX_NAME_LENGTH } from '@capacitylens/shared/lib/strings'

function bodyFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => fields.includes(key))
  )
}

function emailOf(value: unknown) {
  if (typeof value !== 'string') return null
  const email = normalizeAccountEmail(value)
  return isAccountEmail(email) ? email : null
}

function userProjection(actor: Pick<CurrentActor, 'userId' | 'email' | 'displayName'>) {
  return { id: actor.userId, name: actor.displayName ?? undefined, email: actor.email, image: null }
}

/** Signs in through the Account Kit and records the observed sign-in for tracked companies. */
export async function signInWithPassword(ctx: HttpContext, email: string, password: string) {
  await accountKit.authentication.login(
    {
      email,
      password,
      clientKey: ctx.request.ip(),
      sessionLabel: ctx.request.header('user-agent')?.slice(0, 200),
    },
    sessionGuard(ctx)
  )
  return withActor(
    ctx,
    async (actor, trx) => {
      await recordMemberSignIn(actor.userId, trx)
      return userProjection(actor)
    },
    { limited: true }
  )
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
          const admission = await admissionDecision(actor.userId, trx)
          const admitted = actor.emailVerified && admission.admitted
          return {
            authMode: 'password-only',
            user: userProjection(actor),
            canCreateAccount: false,
            emailVerified: actor.emailVerified,
            admission,
            companySetupRequired: admitted && (await requiresFirstCompanySetup(actor.userId, trx)),
            // Admitted but not yet a member: the person completes their membership explicitly.
            membershipRequired:
              admitted &&
              Boolean(await trx.from('accounts').select('id').first()) &&
              !(await trx.from('memberships').where('user_id', actor.userId).first()),
          }
        },
        { limited: true }
      )
    } catch (error) {
      if (!(error instanceof InvalidSessionError)) throw error
      const hasUsers = Boolean(await db.from('users').select('id').first())
      return ctx.response.unauthorized({
        authMode: 'password-only',
        error: 'Sign-in required.',
        passwordResetEmail: Boolean(env.get('CAPACITYLENS_MAIL_HOST')),
        ...(!hasUsers ? { needsSetup: true } : {}),
      })
    }
  }

  async signIn(ctx: HttpContext) {
    const body: unknown = ctx.request.body()
    if (!bodyFields(body, ['email', 'password']))
      return ctx.response.badRequest({ error: 'Invalid sign-in request.' })
    const email = emailOf(body.email)
    if (!email || typeof body.password !== 'string')
      return ctx.response.badRequest({ error: 'Invalid email or password.' })
    try {
      return ctx.response.ok({ user: await signInWithPassword(ctx, email, body.password) })
    } catch (error) {
      if (error instanceof InvalidCredentialsError)
        return ctx.response.unauthorized({ error: 'Invalid email or password.' })
      throw error
    }
  }

  /**
   * Open registration, when the operator enables it, creates a limited identity that still needs
   * a confirmed address and admission. The first identity always comes from the bootstrap invitation.
   */
  async signUp(ctx: HttpContext) {
    const body: unknown = ctx.request.body()
    if (!bodyFields(body, ['email', 'password', 'name']))
      return ctx.response.badRequest({ error: 'Invalid sign-up request.' })
    const email = emailOf(body.email)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (
      !email ||
      typeof body.password !== 'string' ||
      passwordLengthFailure(body.password) ||
      !name ||
      name.length > MAX_NAME_LENGTH
    )
      return ctx.response.badRequest({ error: 'Invalid sign-up details.' })
    if (!env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP') || !(await db.from('accounts').first()))
      return ctx.response.forbidden({ error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' })
    try {
      await accountKit.registration.register({
        email,
        password: body.password,
        registrationData: { name },
      })
    } catch (error) {
      if (error instanceof FirstCompanyPendingError)
        return ctx.response.forbidden({ error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' })
      if (error instanceof RegistrationEmailAlreadyRegisteredError)
        return ctx.response.conflict({
          error: 'An account already uses this email. Sign in or reset your password.',
          code: 'EMAIL_REGISTERED',
        })
      // The account exists; only the confirmation email may be missing, and it can be resent.
      if (!(error instanceof PostCommitError)) throw error
      ctx.logger.warn({ code: 'REGISTRATION_FOLLOW_UP_FAILED' }, 'Registration follow-up failed')
    }
    try {
      return ctx.response.created({ user: await signInWithPassword(ctx, email, body.password) })
    } catch (error) {
      ctx.logger.warn(
        { code: error instanceof Error ? error.name : 'UNKNOWN' },
        'Sign-in after registration failed'
      )
      return ctx.response.accepted({ accountCreated: true, signInRequired: true })
    }
  }

  /** Ends any view-as display, then the Account Kit sign-in, whose row takes its proofs with it. */
  async signOut(ctx: HttpContext) {
    let current: CurrentAccountInput | undefined
    try {
      current = await accountInput(ctx)
      await withActor(ctx, (_actor, trx) => endMasqueradeForSignOut(trx), { limited: true })
    } catch (error) {
      if (!(error instanceof InvalidSessionError)) throw error
    }
    await accountKit.authentication.logout(sessionGuard(ctx), undefined, current)
    return ctx.response.ok({ ok: true })
  }
}
