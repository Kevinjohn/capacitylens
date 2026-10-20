import { createHmac, randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import mail from '@adonisjs/mail/services/main'
import { passwordLengthFailure } from '@capacitylens/shared/domain/password'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import env from '#start/env'
import { assertCompanyAction } from '#services/auth/authorization'
import { resolveCurrentActor } from '#services/auth/session_authority'
import {
  readAccountCommand,
  claimAccountCommand,
  completeAccountCommand,
  readCompletedAccountCommand,
} from '#services/account_commands'
import { withTransaction } from '#services/with_transaction'
import { passwordEnabled } from '#services/auth/mode'
import {
  assertPasswordAllowed,
  PasswordPolicyError,
  PasswordScreeningUnavailableError,
} from '#services/password_screening'
import { hashPassword, PasswordProcessingUnavailableError } from '#services/password_service'
import {
  acceptInvitation,
  createInvitation,
  findInvitationByToken,
  lookupInvitation,
  parseInvitationCreate,
} from '#services/admission/invitations'
import {
  conflictingAdmission,
  forbiddenAdmission,
  invalidAdmission,
  missingAdmission,
} from '#services/admission/errors'
import { renderAdmissionFailure } from '#services/admission/http'
import { reserveInvitationDelivery } from '#services/admission/mail_budget'
import User from '#models/user'
import { createPasswordSession } from '#services/auth/session_login'
import { writeAudit } from '#services/audit'
import { confirmMemberSignIn } from '#services/membership/sign_in_tracking'

function fields(value: unknown, allowed: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  )
}

function inviteLink(token: string) {
  return new URL(
    `/invite/${encodeURIComponent(token)}`,
    env.get('CAPACITYLENS_PUBLIC_URL') || env.get('APP_URL')
  ).href
}

async function notifyInvite(ctx: HttpContext, accountId: string, email: string, token: string) {
  if (!env.get('CAPACITYLENS_MAIL_HOST')) return false
  if (!reserveInvitationDelivery(accountId, email)) return false
  try {
    await mail.send((message) => {
      message
        .to(email)
        .subject('Your CapacityLens invitation')
        .text(`Use this invitation link to join your company: ${inviteLink(token)}`)
    })
    return true
  } catch (error) {
    try {
      ctx.logger.error(
        { code: 'INVITATION_DELIVERY_FAILED' },
        'Invitation delivery failed after commit'
      )
    } catch {
      console.error('Invitation diagnostic logger failed')
    }
    return false
  }
}

/** Product invitation endpoints; bearer material leaves only first successful creation. */
export default class InvitationsController {
  async create(ctx: HttpContext) {
    try {
      const input = parseInvitationCreate(ctx.request.body())
      const command = readAccountCommand(ctx)
      const created = await withTransaction(async (trx) => {
        const { actorId } = await assertCompanyAction(ctx, input.accountId, 'manageInvites', trx)
        await claimAccountCommand(trx, {
          actorId,
          accountId: input.accountId,
          operation: 'create-invitation',
          payload: {
            role: input.role,
            email: input.email,
            expiresAt: input.expiresAt,
            proposedResourceId: input.proposedResourceId ?? null,
          },
          command,
          kind: 'secret',
        })
        const result = await createInvitation(trx, input, actorId)
        await completeAccountCommand(trx, command.commandId, { id: result.id })
        return result
      })
      const emailed =
        created.preauthEmail && env.get('CAPACITYLENS_MAIL_HOST')
          ? await notifyInvite(ctx, created.accountId, created.preauthEmail, created.token)
          : false
      return ctx.response.created({ ...created, emailed })
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  async index(ctx: HttpContext) {
    try {
      const accountId = ctx.params.accountId
      return await withTransaction(async (trx) => {
        await assertCompanyAction(ctx, accountId, 'manageInvites', trx)
        const rows = await trx
          .from('invitations as invitation')
          .leftJoin('invitation_proposals as proposal', 'proposal.invitation_id', 'invitation.id')
          .leftJoin('resources as resource', function () {
            this.on('resource.id', '=', 'proposal.resource_id').andOn(
              'resource.account_id',
              '=',
              'invitation.account_id'
            )
          })
          .where('invitation.account_id', accountId)
          .orderBy('invitation.created_at', 'desc')
          .select(
            'invitation.id',
            'invitation.role',
            'invitation.email',
            'invitation.expires_at',
            'invitation.accepted_at',
            'invitation.created_at',
            'proposal.resource_id',
            'resource.name as resource_name'
          )
        return ctx.response.ok({
          invites: rows.map((row) => {
            if (!['viewer', 'editor', 'admin'].includes(String(row.role)))
              forbiddenAdmission('Invitation role is unavailable.')
            return {
              id: row.id,
              role: row.role,
              preauthEmail: row.email,
              expiresAt: row.expires_at,
              usedAt: row.accepted_at,
              createdAt: row.created_at,
              ...(row.resource_id
                ? { proposedResourceId: row.resource_id, proposedResourceLabel: row.resource_name }
                : {}),
            }
          }),
        })
      })
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  async revoke(ctx: HttpContext) {
    try {
      const { accountId, id } = ctx.params
      const command = readAccountCommand(ctx)
      await withTransaction(async (trx) => {
        const { actorId } = await assertCompanyAction(ctx, accountId, 'manageInvites', trx)
        const claim = await claimAccountCommand(trx, {
          actorId,
          accountId,
          operation: 'revoke-invitation',
          payload: { id },
          command,
          kind: 'semantic',
        })
        if (claim.replayed) return
        const deleted = await trx.from('invitations').where({ id, account_id: accountId }).delete()
        if (!deleted) missingAdmission()
        await writeAudit(trx, {
          accountId,
          actorId,
          action: 'invitation.revoked',
          entity: 'invitation',
          entityId: id,
          fields: ['invitation'],
        })
        await completeAccountCommand(trx, command.commandId, { ok: true })
      })
      return ctx.response.noContent()
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  async preview(ctx: HttpContext) {
    try {
      const result = await withTransaction(async (trx) => {
        const invitation = await lookupInvitation(trx, ctx.params.token)
        const account = await trx
          .from('accounts')
          .where('id', invitation.account_id)
          .select('name')
          .first()
        if (!account) missingAdmission()
        const email = invitation.email as string | null
        return {
          accountId: invitation.account_id,
          accountName: account.name,
          role: invitation.role,
          expiresAt: invitation.expires_at,
          emailBound: Boolean(email),
          emailHint: email ? `${email.slice(0, email.lastIndexOf('@'))}@…` : null,
        }
      })
      return ctx.response.ok(result)
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  async accept(ctx: HttpContext) {
    try {
      const command = readAccountCommand(ctx)
      const result = await withTransaction(async (trx) => {
        const current = await resolveCurrentActor(ctx, trx)
        const invitation = await findInvitationByToken(trx, ctx.params.token)
        if (invitation.email !== current.user.email)
          invalidAdmission('Invitation is addressed to another email.')
        const claimInput = {
          actorId: current.userId,
          accountId: String(invitation.account_id),
          operation: 'accept-invitation',
          payload: { invitationId: invitation.id },
          command,
          kind: 'semantic' as const,
        }
        const completed = await readCompletedAccountCommand(trx, claimInput)
        if (completed) return completed.result
        const claim = await claimAccountCommand(trx, claimInput)
        if (claim.replayed) return claim.result
        await lookupInvitation(trx, ctx.params.token, true)
        const accepted = await acceptInvitation(
          trx,
          invitation,
          current.userId,
          String(current.user.email)
        )
        await confirmMemberSignIn(String(invitation.account_id), current.userId, trx)
        await completeAccountCommand(trx, command.commandId, accepted)
        return accepted
      })
      return ctx.response.ok(result)
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  async signUp(ctx: HttpContext) {
    if (!passwordEnabled())
      return ctx.response.notFound({ error: 'Password admission is unavailable.' })
    try {
      const body: unknown = ctx.request.body()
      if (!fields(body, ['name', 'email', 'password'])) invalidAdmission()
      const email = typeof body.email === 'string' ? normalizeAccountEmail(body.email) : ''
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (
        !isAccountEmail(email) ||
        !name ||
        name.length > 200 ||
        typeof body.password !== 'string' ||
        passwordLengthFailure(body.password)
      )
        invalidAdmission('Invalid sign-up details.')
      const passwordFingerprint = createHmac('sha256', env.get('APP_KEY').release())
        .update('capacitylens-invitation-signup\0')
        .update(body.password)
        .digest('hex')
      const command = readAccountCommand(ctx)
      const completed = await withTransaction(async (trx) => {
        const invitation = await findInvitationByToken(trx, ctx.params.token)
        if (invitation.email !== email)
          invalidAdmission('Invitation is addressed to another email.')
        return readCompletedAccountCommand(trx, {
          actorId: `signup:${email}`,
          accountId: String(invitation.account_id),
          operation: 'signup-invitation',
          payload: { invitationId: invitation.id, email, name, passwordFingerprint },
          command,
          kind: 'semantic',
        })
      })
      if (completed) return ctx.response.created(completed.result)
      await assertPasswordAllowed(body.password)
      const passwordHash = await hashPassword(body.password)
      const result = await withTransaction(async (trx) => {
        const invitation = await findInvitationByToken(trx, ctx.params.token)
        if (invitation.email !== email)
          invalidAdmission('Invitation is addressed to another email.')
        const claim = await claimAccountCommand(trx, {
          actorId: `signup:${email}`,
          accountId: String(invitation.account_id),
          operation: 'signup-invitation',
          payload: { invitationId: invitation.id, email, name, passwordFingerprint },
          command,
          kind: 'semantic',
        })
        if (claim.replayed) return { replayed: true as const, response: claim.result }
        await lookupInvitation(trx, ctx.params.token, true)
        if (invitation.accepted_at) conflictingAdmission()
        if (await trx.from('users').where('email', email).first())
          invalidAdmission('Use your existing account to accept this invitation.')
        const now = new Date().toISOString()
        const userId = randomUUID()
        await trx.table('users').insert({
          id: userId,
          email,
          email_verified: false,
          display_name: name,
          password_hash: passwordHash,
          created_at: now,
          updated_at: now,
        })
        const admitted = await acceptInvitation(trx, invitation, userId, email)
        const response = { ok: true, accountId: admitted.accountId, role: admitted.role }
        await completeAccountCommand(trx, command.commandId, response)
        return { replayed: false as const, response, userId }
      })
      if (!result.replayed) {
        const user = await User.findOrFail(result.userId)
        await createPasswordSession(ctx, user, passwordHash)
      }
      return ctx.response.created(result.response)
    } catch (error) {
      if (
        error instanceof PasswordProcessingUnavailableError ||
        error instanceof PasswordScreeningUnavailableError
      )
        return ctx.response.serviceUnavailable({ error: error.message, code: error.code })
      if (error instanceof PasswordPolicyError)
        return ctx.response.badRequest({ error: error.message, code: error.code })
      return renderAdmissionFailure(ctx, error)
    }
  }
}
