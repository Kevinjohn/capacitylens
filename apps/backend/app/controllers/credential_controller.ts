import type { HttpContext } from '@adonisjs/core/http'
import {
  InvalidInputError,
  InvalidTokenError,
  NoPasswordError,
  IdentityNotConfirmedError,
  ThrottledError,
  PostCommitError,
} from 'adonisjs-account-kit/errors'
import { passwordLengthFailure } from '@capacitylens/shared/domain/password'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import env from '#start/env'
import { passwordEnabled } from '#services/auth/mode'
import { PasswordProcessingUnavailableError } from '#services/password_service'
import {
  PasswordPolicyError,
  PasswordScreeningUnavailableError,
} from '#services/password_screening'
import { PasswordIneligibleError } from '#services/account_kit/users_adapter'
import { SessionAuthorityError } from '#services/auth/session_authority'
import {
  changePassword,
  CredentialUnavailableError,
  requestPublicReset,
  resetPassword,
} from '#services/credentials/operations'

function fields(value: unknown, allowed: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((field) => allowed.includes(field))
  )
}

function password(value: unknown): value is string {
  return typeof value === 'string' && !passwordLengthFailure(value)
}

function privateErrorCode(error: unknown) {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && /^[A-Z_]{2,64}$/.test(code) ? code : 'RECOVERY_REQUEST_FAILED'
}

function renderError(ctx: HttpContext, error: unknown) {
  if (error instanceof SessionAuthorityError && error.code === 'SESSION_NOT_FRESH')
    return ctx.response.forbidden({ error: error.message, code: error.code })
  if (error instanceof SessionAuthorityError || (error as { status?: number })?.status === 401)
    return ctx.response.unauthorized({ error: 'Sign-in required.' })
  if (
    error instanceof PasswordProcessingUnavailableError ||
    error instanceof PasswordScreeningUnavailableError
  )
    return ctx.response.serviceUnavailable({ error: error.message, code: error.code })
  if (error instanceof PasswordPolicyError)
    return ctx.response.badRequest({ error: error.message, code: error.code })
  if (error instanceof ThrottledError)
    return ctx.response.tooManyRequests({ error: 'Too many requests.' })
  if (error instanceof IdentityNotConfirmedError)
    return ctx.response.unauthorized({ error: 'Current password is incorrect.' })
  if (error instanceof InvalidTokenError)
    return ctx.response.badRequest({ error: 'Invalid credential request.', code: 'INVALID_TOKEN' })
  if (
    error instanceof InvalidInputError ||
    error instanceof NoPasswordError ||
    error instanceof PasswordIneligibleError
  )
    return ctx.response.badRequest({ error: 'Invalid credential request.' })
  if (error instanceof PostCommitError)
    return ctx.response.serviceUnavailable({
      error: 'Credential update completed, but a follow-up failed.',
      code: 'CREDENTIAL_UPDATE_COMMITTED',
    })
  if (error instanceof CredentialUnavailableError)
    return ctx.response.serviceUnavailable({ error: error.message, code: error.code })
  throw error
}

export default class CredentialController {
  async requestReset(ctx: HttpContext) {
    if (!passwordEnabled() || !env.get('CAPACITYLENS_MAIL_HOST'))
      return ctx.response.notFound({ error: 'Password recovery is unavailable.' })
    const body: unknown = ctx.request.body()
    if (!fields(body, ['email']) || typeof body.email !== 'string')
      return ctx.response.badRequest({ error: 'Invalid recovery request.' })
    const email = normalizeAccountEmail(body.email)
    if (!isAccountEmail(email))
      return ctx.response.badRequest({ error: 'Invalid recovery request.' })
    try {
      await requestPublicReset(email, ctx.request.ip())
    } catch (error) {
      if (error instanceof ThrottledError) return renderError(ctx, error)
      // Public recovery does not disclose recipient or delivery state.
      try {
        ctx.logger.error({ code: privateErrorCode(error) }, 'Password recovery request failed')
      } catch {
        console.error('Credential diagnostic logger failed')
      }
    }
    return ctx.response.ok({ ok: true })
  }

  async resetPassword(ctx: HttpContext) {
    if (!passwordEnabled())
      return ctx.response.notFound({ error: 'Password recovery is unavailable.' })
    const body: unknown = ctx.request.body()
    if (
      !fields(body, ['token', 'newPassword']) ||
      typeof body.token !== 'string' ||
      !password(body.newPassword)
    )
      return ctx.response.badRequest({ error: 'Invalid recovery request.' })
    try {
      await resetPassword(body.token, body.newPassword)
      return ctx.response.ok({ ok: true })
    } catch (error) {
      return renderError(ctx, error)
    }
  }

  async changePassword(ctx: HttpContext) {
    if (!passwordEnabled())
      return ctx.response.notFound({ error: 'Password change is unavailable.' })
    const body: unknown = ctx.request.body()
    if (
      !fields(body, ['currentPassword', 'newPassword', 'revokeOtherSessions']) ||
      typeof body.currentPassword !== 'string' ||
      !password(body.newPassword) ||
      (body.revokeOtherSessions !== undefined && typeof body.revokeOtherSessions !== 'boolean')
    )
      return ctx.response.badRequest({ error: 'Invalid credential request.' })
    try {
      await changePassword(
        ctx,
        body.currentPassword,
        body.newPassword,
        body.revokeOtherSessions !== false
      )
      return ctx.response.ok({ ok: true })
    } catch (error) {
      return renderError(ctx, error)
    }
  }
}
