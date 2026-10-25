import type { HttpContext } from '@adonisjs/core/http'
import accountKit from 'adonisjs-account-kit/services/main'
import {
  InvalidTokenError,
  PostCommitError,
  RegistrationEmailAlreadyRegisteredError,
} from 'adonisjs-account-kit/errors'
import type { Invitation } from 'adonisjs-account-kit/types'
import { passwordLengthFailure } from '@capacitylens/shared/domain/password'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import { MAX_NAME_LENGTH } from '@capacitylens/shared/lib/strings'
import env from '#start/env'
import { FirstCompanyPendingError } from '#models/user'
import { assertCompanyAction } from '#services/auth/authorization'
import { withActor } from '#services/auth/current_actor'
import { installationCompanyId, isInvitableRole } from '#services/account_kit/policy'
import { invalidAdmission, missingAdmission } from '#services/admission/errors'
import { signInWithPassword } from '#controllers/auth_controller'
import db from '@adonisjs/lucid/services/db'

function fields(value: unknown, allowed: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  )
}

function proofHeaders(ctx: HttpContext) {
  ctx.response.header('Cache-Control', 'no-store')
  ctx.response.header('Referrer-Policy', 'no-referrer')
}

function invitationId(value: unknown) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function projection(invitation: Invitation) {
  return {
    id: invitation.id,
    role: invitation.role,
    preauthEmail: invitation.email,
    expiresAt: invitation.expiresAt.toISO(),
    createdAt: invitation.createdAt.toISO(),
  }
}

const invalidLink = { error: 'This invitation is invalid or has expired.', code: 'INVALID_TOKEN' }

/**
 * Company invitations through the Account Kit: it owns the token, its one lifetime and the email.
 * The Kit re-checks the sender's authority inside the transaction that stores the invitation.
 */
export default class InvitationsController {
  /** Confirms the caller manages invitations for this installation's company. */
  private async manager(ctx: HttpContext, accountId: unknown) {
    if (typeof accountId !== 'string' || !accountId) invalidAdmission()
    return withActor(ctx, async (_actor, trx) => {
      const { actorId } = await assertCompanyAction(accountId, 'manageInvites', trx)
      if ((await installationCompanyId(trx)) !== accountId) missingAdmission('Company not found.')
      return actorId
    })
  }

  async create(ctx: HttpContext) {
    const body: unknown = ctx.request.body()
    if (!fields(body, ['accountId', 'role', 'email']) || !isInvitableRole(body.role))
      invalidAdmission()
    const email = typeof body.email === 'string' ? normalizeAccountEmail(body.email) : ''
    if (!isAccountEmail(email)) invalidAdmission('Invalid invitation email.')
    const actorId = await this.manager(ctx, body.accountId)
    if (!env.get('CAPACITYLENS_MAIL_HOST'))
      return ctx.response.serviceUnavailable({
        error: 'Invitations need email delivery. Ask your administrator to configure mail.',
        code: 'MAIL_UNAVAILABLE',
      })
    try {
      const invitation = await accountKit.invitations.send({ actorId, email, role: body.role })
      return ctx.response.created({ ...projection(invitation), emailed: true })
    } catch (error) {
      if (!(error instanceof PostCommitError)) throw error
      ctx.logger.warn({ code: 'INVITATION_DELIVERY_FAILED' }, 'Invitation delivery failed')
      return ctx.response.accepted({ committed: true, emailed: false })
    }
  }

  async index(ctx: HttpContext) {
    const actorId = await this.manager(ctx, ctx.params.accountId)
    const page = await accountKit.invitations.list({ actorId, limit: 100 })
    return ctx.response.ok({ invites: page.items.map(projection) })
  }

  async resend(ctx: HttpContext) {
    const id = invitationId(ctx.params.id)
    if (!id) invalidAdmission()
    const actorId = await this.manager(ctx, ctx.params.accountId)
    try {
      const invitation = await accountKit.invitations.resend({ actorId, invitationId: id })
      return ctx.response.ok({ ...projection(invitation), emailed: true })
    } catch (error) {
      if (!(error instanceof PostCommitError)) throw error
      return ctx.response.accepted({ committed: true, emailed: false })
    }
  }

  async revoke(ctx: HttpContext) {
    const id = invitationId(ctx.params.id)
    if (!id) invalidAdmission()
    const actorId = await this.manager(ctx, ctx.params.accountId)
    await accountKit.invitations.revoke({ actorId, invitationId: id })
    return ctx.response.noContent()
  }

  /** What the link offers, without spending it. */
  async preview(ctx: HttpContext) {
    proofHeaders(ctx)
    const invitation = await accountKit.invitations.inspect({ token: ctx.params.token })
    if (!invitation) return ctx.response.notFound(invalidLink)
    const accountId = await installationCompanyId(db)
    const account = accountId
      ? await db.from('accounts').where('id', accountId).select('name').first()
      : null
    return ctx.response.ok({
      accountId,
      accountName: account?.name ?? null,
      // Before the company exists the role is only bootstrap metadata; setup grants Owner.
      role: accountId ? invitation.role : null,
      email: invitation.email,
    })
  }

  /**
   * Creates the invited identity with a password and signs it in. The Kit refuses an address that
   * already has an account; a repeated request after a lost response gets the invalid-link answer
   * and the person signs in instead.
   */
  async signUp(ctx: HttpContext) {
    proofHeaders(ctx)
    const body: unknown = ctx.request.body()
    if (!fields(body, ['name', 'password'])) invalidAdmission()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (
      !name ||
      name.length > MAX_NAME_LENGTH ||
      typeof body.password !== 'string' ||
      passwordLengthFailure(body.password)
    )
      invalidAdmission('Invalid sign-up details.')
    let email: string
    try {
      const user = await accountKit.invitations.accept({
        token: ctx.params.token,
        password: body.password,
        registrationData: { name },
      })
      email = user.email
    } catch (error) {
      if (error instanceof InvalidTokenError) return ctx.response.badRequest(invalidLink)
      if (error instanceof RegistrationEmailAlreadyRegisteredError)
        return ctx.response.conflict({
          error: 'An account already uses this email. Sign in instead.',
          code: 'EMAIL_REGISTERED',
        })
      if (error instanceof FirstCompanyPendingError)
        return ctx.response.conflict({ error: error.message, code: error.code })
      throw error
    }
    try {
      return ctx.response.created({ user: await signInWithPassword(ctx, email, body.password) })
    } catch (error) {
      ctx.logger.warn(
        { code: error instanceof Error ? error.name : 'UNKNOWN' },
        'Sign-in after invitation acceptance failed'
      )
      return ctx.response.accepted({ accepted: true, signInRequired: true })
    }
  }
}
