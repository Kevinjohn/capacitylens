import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { assertCompanyAction } from '#services/auth/authorization';
import { runAccountCommand, parseAccountCommand } from '#services/account_commands';
import { clearMemberResourceLink, setMemberResourceLink } from '#services/member_resources/links';
import { invalidAdmission } from '#services/admission/errors';
import { renderAdmissionFailure } from '#services/admission/http';
import { hasOnlyFields } from '#services/request_helpers';

function bodyOf(value: unknown, keys: string[]): Record<string, unknown> {
  if (!hasOnlyFields(value, keys)) invalidAdmission();
  return value;
}

/** Scoped member/person association. */
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
      const command = parseAccountCommand(
        ctx.request.header('x-account-command-id'),
        ctx.request.header('idempotency-key')
      );
      const { companyId: companyId, userId } = ctx.params;
      const result = await withActor(ctx, async (currentActor, trx) => {
        let actor: Awaited<ReturnType<typeof assertCompanyAction>>;
        return runAccountCommand(trx, {
          name: 'set-member-resource-link',
          authorizeAccess: async () => {
            actor = await assertCompanyAction(companyId, 'members:manage', trx);
          },
          work: async () => {
            const { actorId } = actor;
            const link = await setMemberResourceLink(trx, {
              companyId,
              userId,
              resourceId: body.resourceId as string,
              expectedRevision: body.expectedRevision as string | null,
              actorId,
            });
            return { resourceId: link.resourceId, revision: link.revision };
          },
          actorId: currentActor.userId,
          scopeId: companyId,
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
      const command = parseAccountCommand(
        ctx.request.header('x-account-command-id'),
        ctx.request.header('idempotency-key')
      );
      const { companyId: companyId, userId } = ctx.params;
      await withActor(ctx, async (currentActor, trx) => {
        let actor: Awaited<ReturnType<typeof assertCompanyAction>>;
        return runAccountCommand(trx, {
          name: 'clear-member-resource-link',
          authorizeAccess: async () => {
            actor = await assertCompanyAction(companyId, 'members:manage', trx);
          },
          work: async () => {
            const { actorId } = actor;
            await clearMemberResourceLink(trx, {
              companyId,
              userId,
              expectedRevision: body.expectedRevision as string,
              actorId,
            });
            return { ok: true };
          },
          actorId: currentActor.userId,
          scopeId: companyId,
          payload: { principalId: userId, ...body },
          command,
        });
      });
      return ctx.response.noContent();
    } catch (error) {
      return renderAdmissionFailure(ctx, error);
    }
  }
}
