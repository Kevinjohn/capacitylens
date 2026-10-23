import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import mail from '@adonisjs/mail/services/main'
import limiter from '@adonisjs/limiter/services/main'
import { withTransaction } from '#services/with_transaction'
import { activeCompanyRole } from '#services/auth/authorization'
import { resolveCurrentActor } from '#services/auth/session_authority'
import {
  claimAccountCommand,
  completeAccountCommand,
  readAccountCommand,
} from '#services/account_commands'
import { writeAudit } from '#services/audit'
import {
  forbiddenAdmission,
  invalidAdmission,
  missingAdmission,
  proofRequiredAdmission,
} from '#services/admission/errors'
import { renderAdmissionFailure } from '#services/admission/http'
import {
  hasCurrentEmailProof,
  parseJoiningPolicy,
  policyAllowsAdmission,
  readJoiningPolicy,
  writeJoiningPolicy,
} from '#services/admission/joining_policy'
import env from '#start/env'
import { createEmailProofIntent, consumeEmailProofIntent } from '#services/admission/email_proof'
import { reserveInvitationDelivery } from '#services/admission/mail_budget'
import { confirmMemberSignIn } from '#services/membership/sign_in_tracking'
import { advancePlanningRevision } from '#services/planning_revision'

/** Company-scoped admission policy and direct existing-principal joining. */
export default class JoiningController {
  async policy(ctx: HttpContext) {
    try {
      return await withTransaction(async (trx) => {
        const actor = await resolveCurrentActor(ctx, trx)
        const role = await activeCompanyRole(actor.userId, ctx.params.accountId, trx)
        if (role !== 'owner' && role !== 'admin') forbiddenAdmission()
        return ctx.response.ok(await readJoiningPolicy(trx, ctx.params.accountId))
      })
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  async updatePolicy(ctx: HttpContext) {
    try {
      const settings = parseJoiningPolicy(ctx.request.body())
      const command = readAccountCommand(ctx)
      const result = await withTransaction(async (trx) => {
        const actor = await resolveCurrentActor(ctx, trx)
        const role = await activeCompanyRole(actor.userId, ctx.params.accountId, trx)
        if (role !== 'owner') forbiddenAdmission()
        const claim = await claimAccountCommand(trx, {
          actorId: actor.userId,
          accountId: ctx.params.accountId,
          operation: 'set-joining-policy',
          payload: settings,
          command,
          kind: 'semantic',
        })
        if (claim.replayed) return claim.result
        const changed = await writeJoiningPolicy(trx, ctx.params.accountId, settings)
        if (changed)
          await writeAudit(trx, {
            accountId: ctx.params.accountId,
            actorId: actor.userId,
            action: 'joining-policy.updated',
            entity: 'account',
            entityId: ctx.params.accountId,
            fields: ['policy', 'approvedDomains'],
          })
        await completeAccountCommand(trx, command.commandId, settings)
        return settings
      })
      return ctx.response.ok(result)
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  async metadata(ctx: HttpContext) {
    try {
      const result = await withTransaction(async (trx) => {
        const account = await trx
          .from('accounts')
          .where('id', ctx.params.accountId)
          .select('name')
          .first()
        if (!account) missingAdmission('Company not found.')
        return {
          accountId: ctx.params.accountId,
          companyName: account.name,
          passwordAvailable: true,
          providerAvailable: false,
          emailVerificationAvailable: Boolean(env.get('CAPACITYLENS_MAIL_HOST')),
        }
      })
      return ctx.response.ok(result)
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  status(ctx: HttpContext) {
    return ctx.response.ok({ state: 'idle' })
  }

  async completeExisting(ctx: HttpContext) {
    try {
      const body: unknown = ctx.request.body()
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
        invalidAdmission()
      const command = readAccountCommand(ctx)
      const result = await withTransaction(async (trx) => {
        const actor = await resolveCurrentActor(ctx, trx)
        const accountId = ctx.params.accountId
        if (!(await trx.from('accounts').where('id', accountId).first()))
          missingAdmission('Company not found.')
        const settings = await readJoiningPolicy(trx, accountId)
        const email = String(actor.user.email)
        const hasCurrentProof = await hasCurrentEmailProof(trx, actor.userId, email)
        const standing = await trx
          .from('memberships')
          .where({ account_id: accountId, user_id: actor.userId })
          .first()
        if (standing?.status === 'disabled')
          forbiddenAdmission('Company access requires administrator restoration.')
        const restricted = await trx
          .from('account_access_restrictions')
          .where('account_id', accountId)
          .andWhere((query) =>
            query.where('principal_id', actor.userId).orWhere('verified_email', email)
          )
          .first()
        if (restricted) forbiddenAdmission('Company access requires administrator restoration.')
        if (!hasCurrentProof) proofRequiredAdmission()
        if (!policyAllowsAdmission({ settings, email, hasCurrentProof, invitation: 'none' }))
          forbiddenAdmission('This company joining policy does not permit this address.')
        const claim = await claimAccountCommand(trx, {
          actorId: actor.userId,
          accountId,
          operation: 'complete-existing-join',
          payload: {},
          command,
          kind: 'semantic',
        })
        if (claim.replayed) return claim.result
        const role = standing?.status === 'active' ? standing.role : 'viewer'
        if (standing?.status !== 'active') {
          const now = new Date().toISOString()
          if (standing)
            await trx
              .from('memberships')
              .where('id', standing.id)
              .update({ role, status: 'active', updated_at: now })
          else
            await trx.table('memberships').insert({
              id: randomUUID(),
              account_id: accountId,
              user_id: actor.userId,
              role,
              status: 'active',
              created_at: now,
              updated_at: now,
            })
          await advancePlanningRevision(trx, accountId)
          await trx.from('password_reset_tokens').where('tokenable_id', actor.userId).delete()
          await writeAudit(trx, {
            accountId,
            actorId: actor.userId,
            action: 'membership.joined',
            entity: 'membership',
            entityId: actor.userId,
            fields: ['role', 'status'],
          })
        }
        await confirmMemberSignIn(accountId, actor.userId, trx)
        const response = { accountId, role }
        await completeAccountCommand(trx, command.commandId, response)
        return response
      })
      return ctx.response.ok(result)
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  async requestProof(ctx: HttpContext) {
    if (!env.get('CAPACITYLENS_MAIL_HOST'))
      return ctx.response.notFound({ error: 'Email verification is unavailable.' })
    try {
      const body: unknown = ctx.request.body()
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
        invalidAdmission()
      const actor = await resolveCurrentActor(ctx)
      const email = String(actor.user.email)
      if (!reserveInvitationDelivery(ctx.params.accountId, email))
        return ctx.response.tooManyRequests({ error: 'Verification email limit reached.' })
      await limiter
        .use({ requests: 3, duration: '10 minutes' })
        .consume(`join-proof:${actor.userId}`)
      const token = await withTransaction(async (trx) => {
        const current = await resolveCurrentActor(ctx, trx)
        if (!(await trx.from('accounts').where('id', ctx.params.accountId).first()))
          missingAdmission('Company not found.')
        return createEmailProofIntent(trx, {
          accountId: ctx.params.accountId,
          userId: current.userId,
          sessionId: current.sessionId,
          email: String(current.user.email),
          sourceIp: ctx.request.ip(),
        })
      })
      const link = new URL(
        `/join/${encodeURIComponent(ctx.params.accountId)}#verify=${token}`,
        env.get('CAPACITYLENS_PUBLIC_URL') || env.get('APP_URL')
      ).href
      try {
        await mail.send((message) => {
          message
            .to(email)
            .subject('Verify your email to join a company')
            .text(
              `Open this link while signed in to verify your email and join the company. The link expires in 60 minutes.\n\n${link}`
            )
        })
      } catch {
        try {
          ctx.logger.error({ code: 'JOIN_PROOF_DELIVERY_FAILED' }, 'Joining proof delivery failed')
        } catch {
          console.error('Joining diagnostic logger failed')
        }
        return ctx.response.serviceUnavailable({ error: 'Verification email could not be sent.' })
      }
      return ctx.response.ok({ sent: true })
    } catch (error) {
      if ((error as { status?: number })?.status === 429)
        return ctx.response.tooManyRequests({ error: 'Verification email limit reached.' })
      return renderAdmissionFailure(ctx, error)
    }
  }

  async verifyEmail(ctx: HttpContext) {
    try {
      const body: unknown = ctx.request.body()
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        typeof (body as Record<string, unknown>).token !== 'string'
      )
        invalidAdmission()
      await withTransaction(async (trx) => {
        const actor = await resolveCurrentActor(ctx, trx)
        await consumeEmailProofIntent(trx, {
          token: (body as { token: string }).token,
          userId: actor.userId,
          sessionId: actor.sessionId,
          email: String(actor.user.email),
        })
      })
      return ctx.response.ok({ ok: true })
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }
}
