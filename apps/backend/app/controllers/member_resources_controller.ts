import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { assertCompanyAction } from '#services/auth/authorization';
import { runAccountCommand, readAccountCommand } from '#services/account_commands';
import { writeAudit } from '#services/audit';
import { clearMemberResourceLink, setMemberResourceLink } from '#services/member_resources/links';
import { invalidAdmission } from '#services/admission/errors';
import { renderAdmissionFailure } from '#services/admission/http';
import { hasOnlyFields } from '#services/request_helpers';
import { readMemberAvatars } from '#services/member_resources/directory';

function bodyOf(value: unknown, keys: string[]): Record<string, unknown> {
  if (!hasOnlyFields(value, keys)) invalidAdmission();
  return value;
}

/** Scoped member/person association and the read-only avatar projection. */
export default class MemberResourcesController {
  async setLink(ctx: HttpContext) {
    try {
      const body = bodyOf(ctx.request.body(), ['resourceId', 'expectedRevision']);
      if (
        typeof body.resourceId !== 'string' ||
        !body.resourceId ||
        !(body.expectedRevision === null || typeof body.expectedRevision === 'string')
      ) {
        invalidAdmission();
      }
      const command = readAccountCommand(ctx);
      const { accountId, userId } = ctx.params;
      const result = await withActor(ctx, async (currentActor, trx) => {
        let actor: Awaited<ReturnType<typeof assertCompanyAction>>;
        return runAccountCommand(trx, {
          name: 'set-member-resource-link',
          authorizeAccess: async () => {
            actor = await assertCompanyAction(accountId, 'members:manage', trx);
          },
          work: async () => {
            const { actorId } = actor;
            const link = await setMemberResourceLink(trx, {
              accountId,
              userId,
              resourceId: body.resourceId as string,
              expectedRevision: body.expectedRevision as string | null,
            });
            if (link.changed) {
              await writeAudit(trx, {
                accountId,
                actorId,
                action: 'member-resource.linked',
                entity: 'membership',
                entityId: userId,
                fields: ['resourceLink'],
              });
            }
            return { resourceId: link.resourceId, revision: link.revision };
          },
          actorId: currentActor.userId,
          scopeId: accountId,
          payload: { principalId: userId, ...body },
          command,
        });
      });
      return ctx.response.ok(result);
    } catch (error) {
      return renderAdmissionFailure(ctx, error);
    }
  }

  async clearLink(ctx: HttpContext) {
    try {
      const body = bodyOf(ctx.request.body(), ['expectedRevision']);
      if (typeof body.expectedRevision !== 'string' || !body.expectedRevision) invalidAdmission();
      const command = readAccountCommand(ctx);
      const { accountId, userId } = ctx.params;
      await withActor(ctx, async (currentActor, trx) => {
        let actor: Awaited<ReturnType<typeof assertCompanyAction>>;
        return runAccountCommand(trx, {
          name: 'clear-member-resource-link',
          authorizeAccess: async () => {
            actor = await assertCompanyAction(accountId, 'members:manage', trx);
          },
          work: async () => {
            const { actorId } = actor;
            await clearMemberResourceLink(trx, {
              accountId,
              userId,
              expectedRevision: body.expectedRevision as string,
            });
            await writeAudit(trx, {
              accountId,
              actorId,
              action: 'member-resource.unlinked',
              entity: 'membership',
              entityId: userId,
              fields: ['resourceLink'],
            });
            return { ok: true };
          },
          actorId: currentActor.userId,
          scopeId: accountId,
          payload: { principalId: userId, ...body },
          command,
        });
      });
      return ctx.response.noContent();
    } catch (error) {
      return renderAdmissionFailure(ctx, error);
    }
  }

  async avatars(ctx: HttpContext) {
    try {
      const { accountId } = ctx.params;
      return await withActor(ctx, async (_actor, trx) => {
        await assertCompanyAction(accountId, 'planning:read', trx);
        return ctx.response.ok(await readMemberAvatars(trx, accountId));
      });
    } catch (error) {
      return renderAdmissionFailure(ctx, error);
    }
  }
}
