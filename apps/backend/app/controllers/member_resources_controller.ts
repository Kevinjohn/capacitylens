import type { HttpContext } from '@adonisjs/core/http'
import { withTransaction } from '#services/with_transaction'
import { advancePlanningRevision } from '#services/planning_revision'
import { assertCompanyAction } from '#services/auth/authorization'
import {
  claimAccountCommand,
  completeAccountCommand,
  readAccountCommand,
} from '#services/account_commands'
import { writeAudit } from '#services/audit'
import { clearMemberResourceLink, setMemberResourceLink } from '#services/member_resources/links'
import { invalidAdmission } from '#services/admission/errors'
import { renderAdmissionFailure } from '#services/admission/http'
import { parseResourceAvatarUrl } from '@capacitylens/shared/domain/resourceAvatarUrl'

function bodyOf(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    invalidAdmission()
  return value as Record<string, unknown>
}

/** Scoped member/person association and the read-only avatar projection. */
export default class MemberResourcesController {
  async setLink(ctx: HttpContext) {
    try {
      const body = bodyOf(ctx.request.body(), ['resourceId', 'expectedRevision'])
      if (
        typeof body.resourceId !== 'string' ||
        !body.resourceId ||
        !(body.expectedRevision === null || typeof body.expectedRevision === 'string')
      )
        invalidAdmission()
      const command = readAccountCommand(ctx)
      const { accountId, principalId } = ctx.params
      const result = await withTransaction(async (trx) => {
        const { actorId } = await assertCompanyAction(ctx, accountId, 'manageMembers', trx)
        const claim = await claimAccountCommand(trx, {
          actorId,
          accountId,
          operation: 'set-member-resource-link',
          payload: { principalId, ...body },
          command,
          kind: 'semantic',
        })
        if (claim.replayed) return claim.result
        const link = await setMemberResourceLink(trx, {
          accountId,
          userId: principalId,
          resourceId: body.resourceId as string,
          expectedRevision: body.expectedRevision as string | null,
        })
        await writeAudit(trx, {
          accountId,
          actorId,
          action: 'member-resource.linked',
          entity: 'membership',
          entityId: principalId,
          fields: ['resourceLink'],
        })
        await completeAccountCommand(trx, command.commandId, link)
        return link
      })
      return ctx.response.ok(result)
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  async clearLink(ctx: HttpContext) {
    try {
      const body = bodyOf(ctx.request.body(), ['expectedRevision'])
      if (typeof body.expectedRevision !== 'string' || !body.expectedRevision) invalidAdmission()
      const command = readAccountCommand(ctx)
      const { accountId, principalId } = ctx.params
      await withTransaction(async (trx) => {
        const { actorId } = await assertCompanyAction(ctx, accountId, 'manageMembers', trx)
        const claim = await claimAccountCommand(trx, {
          actorId,
          accountId,
          operation: 'clear-member-resource-link',
          payload: { principalId, ...body },
          command,
          kind: 'semantic',
        })
        if (claim.replayed) return
        await clearMemberResourceLink(trx, {
          accountId,
          userId: principalId,
          expectedRevision: body.expectedRevision as string,
        })
        await writeAudit(trx, {
          accountId,
          actorId,
          action: 'member-resource.unlinked',
          entity: 'membership',
          entityId: principalId,
          fields: ['resourceLink'],
        })
        await completeAccountCommand(trx, command.commandId, { ok: true })
      })
      return ctx.response.noContent()
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  async clearException(ctx: HttpContext) {
    try {
      const command = readAccountCommand(ctx)
      const { accountId, principalId } = ctx.params
      await withTransaction(async (trx) => {
        const { actorId } = await assertCompanyAction(ctx, accountId, 'manageMembers', trx)
        const claim = await claimAccountCommand(trx, {
          actorId,
          accountId,
          operation: 'clear-member-resource-exception',
          payload: { principalId },
          command,
          kind: 'semantic',
        })
        if (claim.replayed) return
        const removed = await trx
          .from('member_resource_link_exceptions')
          .where({ account_id: accountId, user_id: principalId })
          .delete()
        if (removed) await advancePlanningRevision(trx, accountId)
        await completeAccountCommand(trx, command.commandId, { ok: true })
      })
      return ctx.response.noContent()
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }

  async avatars(ctx: HttpContext) {
    try {
      const { accountId } = ctx.params
      return await withTransaction(async (trx) => {
        await assertCompanyAction(ctx, accountId, 'read', trx)
        const rows = await trx
          .from('account_member_resources as link')
          .innerJoin('resources as resource', function () {
            this.on('resource.id', '=', 'link.resource_id').andOn(
              'resource.account_id',
              '=',
              'link.account_id'
            )
          })
          .innerJoin('memberships as member', function () {
            this.on('member.user_id', '=', 'link.user_id').andOn(
              'member.account_id',
              '=',
              'link.account_id'
            )
          })
          .where('link.account_id', accountId)
          .where('member.status', 'active')
          .where('resource.kind', 'person')
          .whereNull('resource.archived_at')
          .whereNull('resource.deleted_at')
          .select('resource.id', 'resource.avatar_url')
        return ctx.response.ok({
          avatars: rows.flatMap((row) => {
            const imageUrl = parseResourceAvatarUrl(row.avatar_url)
            return imageUrl ? [{ resourceId: row.id, imageUrl }] : []
          }),
        })
      })
    } catch (error) {
      return renderAdmissionFailure(ctx, error)
    }
  }
}
