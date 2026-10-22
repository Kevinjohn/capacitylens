import { requiresFirstCompanySetup } from '#services/first_company_setup'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import env from '#start/env'
import User from '#models/user'
import { createPasswordSession } from '#services/auth/session_login'
import { withTransaction } from '#services/with_transaction'
import { authMode, availableProviders, passwordEnabled } from '#services/auth/mode'
import {
  destroyNativeSessions,
  resolveCurrentActor,
  SessionAuthorityError,
} from '#services/auth/session_authority'
import {
  hashPassword,
  verifyPassword,
  PasswordProcessingUnavailableError,
  UNMATCHABLE_PASSWORD_HASH,
  runWithPasswordAbortSignal,
} from '#services/password_service'
import { assertPasswordAllowed } from '#services/password_screening'
import { passwordLengthFailure } from '@capacitylens/shared/domain/password'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import { consumeFailedSignInBudget, resetFailedSignInBudget } from '#services/auth/request_limit'
import { endMasqueradeForSignOut } from '#services/auth/masquerade'

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

function passwordOf(value: unknown) {
  return typeof value === 'string' && !passwordLengthFailure(value) ? value : null
}

function equalSecret(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function userProjection(user: User) {
  return {
    id: String(user.id),
    name: user.displayName ?? undefined,
    email: user.email,
    image: null,
  }
}

async function withRequestPasswordWork<T>(ctx: HttpContext, work: () => Promise<T>): Promise<T> {
  const cancellation = new AbortController()
  const abort = () => cancellation.abort()
  ctx.request.request.once('aborted', abort)
  try {
    return await runWithPasswordAbortSignal(cancellation.signal, work)
  } finally {
    ctx.request.request.off('aborted', abort)
  }
}

export default class AuthController {
  async me(ctx: HttpContext) {
    const mode = authMode()
    try {
      const actor = await resolveCurrentActor(ctx)
      return {
        authMode: mode,
        user: userProjection(actor.user),
        providers: availableProviders(),
        canCreateAccount: false,
        companySetupRequired: await withTransaction(async (trx) => {
          await trx.from('account_transaction_lock').where('id', 1).increment('version', 1)
          return requiresFirstCompanySetup(actor.userId, trx)
        }),
        reauthMethod: passwordEnabled() && actor.user.passwordHash ? 'password' : 'provider',
        reauthProviderId: passwordEnabled() && actor.user.passwordHash ? null : 'google',
      }
    } catch (error) {
      if (
        !(error instanceof SessionAuthorityError) &&
        (error as { status?: number }).status !== 401
      )
        throw error
      const hasUsers = Boolean(await db.from('users').select('id').first())
      return ctx.response.unauthorized({
        authMode: mode,
        providers: availableProviders(),
        error: 'Sign-in required.',
        passwordResetEmail: passwordEnabled() && Boolean(env.get('CAPACITYLENS_MAIL_HOST')),
        ...(!hasUsers && passwordEnabled() ? { needsSetup: true } : {}),
      })
    }
  }

  async signIn(ctx: HttpContext) {
    if (!passwordEnabled())
      return ctx.response.notFound({ error: 'Password sign-in is unavailable.' })
    const body: unknown = ctx.request.body()
    if (!bodyFields(body, ['email', 'password']))
      return ctx.response.badRequest({ error: 'Invalid sign-in request.' })
    const email = emailOf(body.email)
    if (!email || typeof body.password !== 'string')
      return ctx.response.badRequest({ error: 'Invalid email or password.' })
    const user = await User.query().where('email', email).first()
    const hash = user?.passwordHash
    try {
      if (!(await consumeFailedSignInBudget(ctx)))
        return ctx.response.tooManyRequests({ error: 'Rate limit exceeded.' })
      // Unknown and provider-only addresses pay the same derivation, so timing reveals no account.
      const verified = await withRequestPasswordWork(ctx, () =>
        verifyPassword(hash || UNMATCHABLE_PASSWORD_HASH, body.password as string)
      )
      if (!hash || !verified)
        return ctx.response.unauthorized({ error: 'Invalid email or password.' })
      await createPasswordSession(ctx, user, hash)
      await resetFailedSignInBudget(ctx)
      return ctx.response.ok({ user: userProjection(user) })
    } catch (error) {
      if (error instanceof SessionAuthorityError)
        return ctx.response.unauthorized({ error: 'Credentials changed; sign in again.' })
      if (error instanceof PasswordProcessingUnavailableError)
        return ctx.response.serviceUnavailable({ error: error.message, code: error.code })
      throw error
    }
  }

  async signUp(ctx: HttpContext) {
    if (!passwordEnabled())
      return ctx.response.notFound({ error: 'Password sign-up is unavailable.' })
    const body: unknown = ctx.request.body()
    if (!bodyFields(body, ['email', 'password', 'name']))
      return ctx.response.badRequest({ error: 'Invalid sign-up request.' })
    const email = emailOf(body.email)
    const password = passwordOf(body.password)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!email || !password || !name || name.length > 200)
      return ctx.response.badRequest({ error: 'Invalid sign-up details.' })
    const usersExist = Boolean(await db.from('users').select('id').first())
    if (usersExist && !env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'))
      return ctx.response.forbidden({ error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' })
    if (!usersExist) {
      const configured = env.get('CAPACITYLENS_SETUP_TOKEN')
      const submitted = ctx.request.header('x-capacitylens-setup-token') ?? ''
      if (!configured || !equalSecret(configured, submitted))
        return ctx.response.forbidden({
          error: 'A valid setup token is required.',
          code: 'INVALID_SETUP_TOKEN',
        })
    }
    const hash = await withRequestPasswordWork(ctx, async () => {
      await assertPasswordAllowed(password)
      return hashPassword(password)
    })
    const now = new Date().toISOString()
    const id = randomUUID()
    try {
      await withTransaction(async (trx) => {
        await trx.from('account_transaction_lock').where('id', 1).increment('version', 1)
        if (!usersExist && (await trx.from('users').select('id').first()))
          throw new SessionAuthorityError('Setup has already completed.')
        await trx.table('users').insert({
          id,
          email,
          email_verified: 0,
          display_name: name,
          password_hash: hash,
          created_at: now,
          updated_at: now,
        })
      })
    } catch (error) {
      if (error instanceof SessionAuthorityError)
        return ctx.response.forbidden({ error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' })
      throw error
    }
    const user = await User.findOrFail(id)
    await createPasswordSession(ctx, user, hash)
    return ctx.response.created({ user: userProjection(user) })
  }

  async signOut(ctx: HttpContext) {
    try {
      const actor = await resolveCurrentActor(ctx)
      await withTransaction(async (trx) => {
        await endMasqueradeForSignOut(ctx, trx)
        await trx
          .from('user_session_index')
          .where({ user_id: actor.userId, session_id: actor.sessionId })
          .delete()
        await trx
          .from('action_proofs')
          .where({ user_id: actor.userId, session_id: actor.sessionId })
          .delete()
      })
      try {
        await ctx.auth.use('web').logout()
        await destroyNativeSessions([actor.sessionId])
      } catch (error) {
        ctx.logger.warn({ err: error }, 'Native sign-out cleanup failed after index revocation')
      }
    } catch (error) {
      if (
        !(error instanceof SessionAuthorityError) &&
        (error as { status?: number }).status !== 401
      )
        throw error
    }
    return ctx.response.ok({ ok: true })
  }
}
