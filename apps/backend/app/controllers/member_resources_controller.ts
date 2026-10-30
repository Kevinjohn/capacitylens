import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { assertCompanyAction } from '#services/auth/authorization';
import {
  claimAccountCommand,
  completeAccountCommand,
  readAccountCommand,
} from '#services/account_commands';
import { writeAudit } from '#services/audit';
import { clearMemberResourceLink, setMemberResourceLink } from '#services/member_resources/links';
import { invalidAdmission } from '#services/admission/errors';
import { renderAdmissionFailure } from '#services/admission/http';
import { readMemberAvatars } from '#services/member_resources/directory';

function bodyOf(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    invalidAdmission();
  }
  return value as Record<string, unknown>;
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
      const { accountId, principalId } = ctx.params;
      const result = await withActor(ctx, async (_actor, trx) => {
        const { actorId } = await assertCompanyAction(accountId, 'manageMembers', trx);
        const claim = await claimAccountCommand(trx, {
          actorId,
          accountId,
          operation: 'set-member-resource-link',
          payload: { principalId, ...body },
          command,
          kind: 'semantic',
        });
        if (claim.replayed) return claim.result;
        const link = await setMemberResourceLink(trx, {
          accountId,
          userId: principalId,
          resourceId: body.resourceId as string,
          expectedRevision: body.expectedRevision as string | null,
        });
        if (link.changed) {
          await writeAudit(trx, {
            accountId,
            actorId,
            action: 'member-resource.linked',
            entity: 'membership',
            entityId: principalId,
            fields: ['resourceLink'],
          });
        }
        const commandResult = { resourceId: link.resourceId, revision: link.revision };
        await completeAccountCommand(trx, command.commandId, commandResult);
        return commandResult;
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
      const { accountId, principalId } = ctx.params;
      await withActor(ctx, async (_actor, trx) => {
        const { actorId } = await assertCompanyAction(accountId, 'manageMembers', trx);
        const claim = await claimAccountCommand(trx, {
          actorId,
          accountId,
          operation: 'clear-member-resource-link',
          payload: { principalId, ...body },
          command,
          kind: 'semantic',
        });
        if (claim.replayed) return;
        await clearMemberResourceLink(trx, {
          accountId,
          userId: principalId,
          expectedRevision: body.expectedRevision as string,
        });
        await writeAudit(trx, {
          accountId,
          actorId,
          action: 'member-resource.unlinked',
          entity: 'membership',
          entityId: principalId,
          fields: ['resourceLink'],
        });
        await completeAccountCommand(trx, command.commandId, { ok: true });
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
        await assertCompanyAction(accountId, 'read', trx);
        return ctx.response.ok(await readMemberAvatars(trx, accountId));
      });
    } catch (error) {
      return renderAdmissionFailure(ctx, error);
    }
  }
}
