import type { HttpContext } from '@adonisjs/core/http'
import { newId } from '@capacitylens/shared/lib/id'
import { readState, readStateWithClient } from '#services/state_repository'
import { applyBatch } from '#services/batch/service'
import { BatchRequestError } from '#services/batch/errors'
import { dataContextForActor, trustedLocalDataContext } from '#services/batch/data_policy'
import { withTransaction } from '#services/with_transaction'
import { writeAudit } from '#services/audit'
import env from '#start/env'
import { validateEntityRow } from '#validators/entities/index'
import { cleanText } from '@capacitylens/shared/lib/strings'
import { assertFrozenAccountFields } from '#services/batch/entity_policy'
import { FALLBACK_PRESET_COLOR } from '@capacitylens/shared/lib/color'
import { timingSafeEqual } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import db from '@adonisjs/lucid/services/db'
import { authMode } from '#services/auth/mode'
import {
  assertCompanyAction,
  IdentityAuthorityError,
  restrictedCompanyIds,
} from '#services/auth/authorization'
import { resolveCurrentActor } from '#services/auth/session_authority'
import {
  AccountCommandError,
  claimAccountCommand,
  completeAccountCommand,
  readAccountCommand,
} from '#services/account_commands'
import { eraseCompany } from '#services/membership/company_erasure'

function objectBody(body: unknown): body is Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
}

function validateSuppliedRevisions(
  requested: Record<string, unknown>,
  existing: { createdAt: string; updatedAt: string } | undefined
) {
  for (const field of ['createdAt', 'updatedAt'] as const) {
    if (!Object.hasOwn(requested, field) || requested[field] === existing?.[field]) continue
    const value = requested[field]
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > 256 ||
      /[\p{C}\s]/u.test(value)
    )
      throw new BatchRequestError(`${field} must be a bounded identifier.`)
  }
}

function assertCurrentPatchRevision(
  requested: Record<string, unknown>,
  existing: { updatedAt: string }
) {
  if (!Object.hasOwn(requested, 'updatedAt')) return
  const stored = Date.parse(String(existing.updatedAt))
  if (
    !Number.isFinite(stored) ||
    (typeof requested.updatedAt === 'string' && Date.parse(requested.updatedAt) === stored)
  )
    return
  throw new BatchRequestError('The record was modified more recently on the server.', 409, {
    ...existing,
  })
}

async function validateCompanyFields(row: Record<string, unknown>) {
  try {
    await validateEntityRow('accounts', row)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'E_VALIDATION_ERROR' &&
      'messages' in error &&
      Array.isArray(error.messages)
    ) {
      const first = error.messages[0]
      if (typeof first?.message === 'string') throw new BatchRequestError(first.message)
    }
    throw error
  }
  if (typeof row.name !== 'string' || cleanText(row.name).length === 0)
    throw new BatchRequestError('Company name is required.')
}

function matchesBootstrapToken(configured: string | undefined, submitted: string | undefined) {
  if (!configured || !submitted) return false
  const expected = Buffer.from(configured)
  const actual = Buffer.from(submitted)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export default class CompaniesController {
  async index(ctx: HttpContext) {
    const installationAccounts = await db.from('accounts').count('* as count').first()
    if (Number(installationAccounts?.count ?? 0) > 1)
      return ctx.response.conflict({
        error:
          'This installation has more than one company. Contact the administrator to resolve it.',
      })
    if (authMode() === 'off') {
      const state = await readState()
      return ctx.response.ok(
        state.accounts
          .map(({ id, name }) => ({ id, name, role: 'owner' as const }))
          .sort((left, right) => left.name.localeCompare(right.name))
      )
    }
    const summaries = await withTransaction(async (trx) => {
      const actor = await resolveCurrentActor(ctx, trx)
      const restricted = await restrictedCompanyIds(actor.userId, trx)
      const rows = await trx
        .from('memberships as member')
        .innerJoin('accounts as account', 'account.id', 'member.account_id')
        .where({ 'member.user_id': actor.userId, 'member.status': 'active' })
        .select('account.id', 'account.name', 'member.role')
      return rows
        .filter((row) => !restricted.has(String(row.id)))
        .sort((left, right) => String(left.name).localeCompare(String(right.name)))
    })
    return ctx.response.ok(summaries)
  }

  private async creationActor(ctx: HttpContext, trx: TransactionClientContract) {
    const actor = await resolveCurrentActor(ctx, trx)
    const hasCompany = Boolean(await trx.from('accounts').select('id').first())
    if (!hasCompany) return actor.userId
    if (
      matchesBootstrapToken(
        env.get('CAPACITYLENS_BOOTSTRAP_TOKEN'),
        ctx.request.header('x-capacitylens-bootstrap-token')
      )
    )
      return actor.userId
    const standing = await trx
      .from('memberships')
      .where({ user_id: actor.userId, status: 'active' })
      .whereIn('role', ['owner', 'admin'])
      .select('account_id')
    const restricted = await restrictedCompanyIds(actor.userId, trx)
    if (!standing.some((row) => !restricted.has(String(row.account_id))))
      throw new IdentityAuthorityError('Forbidden.')
    return actor.userId
  }

  private logCommitted(ctx: HttpContext) {
    return (event: { applied: number; changed: number }) =>
      ctx.logger.info({ event: 'capacitylens.company.committed', ...event })
  }

  private async write(
    ctx: HttpContext,
    id?: string,
    patch = false,
    requireId = false,
    org = false
  ) {
    const { request, response } = ctx
    if (!objectBody(request.body()))
      return response.badRequest({ error: 'Company details must be an object.' })
    const requested = request.body() as Record<string, unknown>
    if (requireId && typeof requested.id !== 'string')
      return response.badRequest({ error: 'A string id is required.' })
    if (!requireId && !patch && Object.hasOwn(requested, 'id') && typeof requested.id !== 'string')
      return response.badRequest({ error: 'id must be a string.' })
    const accountId = id ?? (typeof requested.id === 'string' ? requested.id : newId())
    if (id && requested.id !== undefined && requested.id !== id)
      return response.badRequest({ error: 'Company id must match the URL.' })
    try {
      const command = !patch && org && authMode() !== 'off' ? readAccountCommand(ctx) : null
      const result = await withTransaction(async (trx) => {
        const authenticatedCreate = !patch && org && authMode() !== 'off'
        const actorId = authenticatedCreate ? await this.creationActor(ctx, trx) : null
        if (command && actorId) {
          const claim = await claimAccountCommand(trx, {
            actorId,
            operation: 'create-company',
            accountId: typeof requested.id === 'string' ? requested.id : '@generated',
            payload: requested,
            command,
            kind: 'semantic',
            receiptSurvivesAccountDeletion: true,
          })
          if (claim.replayed) {
            const receipt = claim.result as { accountId?: unknown }
            if (typeof receipt.accountId !== 'string') throw new Error('Invalid company receipt')
            return { accountId: receipt.accountId, existed: false }
          }
        }
        const context = authenticatedCreate
          ? trustedLocalDataContext(actorId!, this.logCommitted(ctx))
          : await dataContextForActor(ctx, trx, this.logCommitted(ctx))
        const state = await readStateWithClient(trx, accountId, true)
        const existing = state.accounts[0]
        if (patch && !existing) throw new BatchRequestError('Company not found.', 404)
        validateSuppliedRevisions(requested, patch ? existing : undefined)
        const now = new Date().toISOString()
        const row = {
          ...(patch ? existing : {}),
          ...requested,
          id: accountId,
          ...(!patch && !Object.hasOwn(requested, 'color') ? { color: FALLBACK_PRESET_COLOR } : {}),
          ...(!patch && !requireId
            ? {
                schedulingMode: requested.schedulingMode ?? 'days',
                inlineActivityCreateEnabled: requested.inlineActivityCreateEnabled ?? false,
              }
            : {}),
          createdAt: patch ? (existing?.createdAt ?? now) : now,
          updatedAt: patch ? (existing?.updatedAt ?? now) : now,
        }
        await validateCompanyFields(row)
        if (patch && existing) {
          assertFrozenAccountFields(requested, row, { ...existing })
          assertCurrentPatchRevision(requested, existing)
        }
        if (!patch) {
          if (await trx.from('accounts').select('id').first())
            throw new BatchRequestError(
              'This installation already has a company.',
              403,
              undefined,
              'FORBIDDEN'
            )
          if (existing) throw new BatchRequestError('Company already exists.', 409)
        }
        const applied = await applyBatch(
          trx,
          [{ method: 'PUT', table: 'accounts', id: accountId, row }],
          null,
          context,
          { allowInitialCompanyCreation: !patch }
        )
        if (authenticatedCreate && actorId) {
          await trx.table('memberships').insert({
            id: newId(),
            account_id: accountId,
            user_id: actorId,
            role: 'owner',
            status: 'active',
            created_at: now,
            updated_at: now,
          })
          await trx.from('password_reset_tokens').where('tokenable_id', actorId).delete()
          await trx
            .from('command_results')
            .where('command_id', command!.commandId)
            .update({ account_id: accountId })
          await completeAccountCommand(trx, command!.commandId, { accountId })
        }
        return { accountId, applied, existed: existing !== undefined }
      })
      const currentState = await readState(result.accountId, true)
      const current = currentState.accounts[0]
      if (!current) throw new Error('Company write did not persist')
      if (result.applied?.auditWarning) response.header('x-capacitylens-audit-warning', 'true')
      return result.existed ? response.ok(current) : response.created(current)
    } catch (error) {
      if (error instanceof AccountCommandError)
        return response.status(error.status).send({ error: error.message, code: error.code })
      if (error instanceof BatchRequestError) {
        return response.status(error.status).send({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...(error.current ? { current: error.current } : {}),
        })
      }
      throw error
    }
  }

  store(ctx: HttpContext) {
    if (authMode() !== 'off')
      return ctx.response.forbidden({
        error: 'Use /api/orgs to create a company.',
        code: 'FORBIDDEN',
      })
    return this.write(ctx, undefined, false, true)
  }

  storeOrg(ctx: HttpContext) {
    return this.write(ctx, undefined, false, false, true)
  }

  update(ctx: HttpContext) {
    return this.write(ctx, ctx.params.id, true)
  }

  async destroy(ctx: HttpContext) {
    const { response, params, logger } = ctx
    const accountId = params.id
    try {
      const command = readAccountCommand(ctx)
      await withTransaction(async (trx) => {
        const account = await trx.from('accounts').select('id').where('id', accountId).first()
        if (!account && authMode() === 'off') return
        const actor = authMode() === 'off' ? null : await resolveCurrentActor(ctx, trx)
        const actorId = actor?.userId ?? ctx.auth.use('trustedLocal').getUserOrFail().id
        const claim = await claimAccountCommand(trx, {
          actorId,
          operation: 'erase-company',
          accountId,
          payload: { accountId },
          command,
          kind: 'semantic',
          receiptSurvivesAccountDeletion: true,
        })
        if (claim.replayed) return
        if (authMode() !== 'off')
          await assertCompanyAction(ctx, accountId, 'deleteAccount', trx, true)
        await writeAudit(trx, {
          accountId,
          actorId,
          action: 'delete',
          entity: 'accounts',
          entityId: accountId,
          fields: [],
        })
        await eraseCompany(accountId, trx, command.commandId)
        await completeAccountCommand(trx, command.commandId, { accountId, erased: true })
      })
    } catch (error) {
      if (error instanceof AccountCommandError)
        return response.status(error.status).send({ error: error.message, code: error.code })
      throw error
    }
    try {
      logger.info({ event: 'capacitylens.company.deleted', accountId })
    } catch {
      response.header('x-capacitylens-audit-warning', 'true')
    }
    return response.noContent()
  }
}
