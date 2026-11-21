import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { assertCompanyPermission } from '#services/auth/authorization';
import { runAccountCommand, parseAccountCommand } from '#services/account_commands';
import { clearMemberResourceLink, setMemberResourceLink } from '#services/member_resources/links';
import { refuseInvalidAdmissionBody } from '#services/admission/errors';
import { clearLinkValidator, setLinkValidator } from '#validators/member_resources';

/** Scoped member/person association. */
export default class MemberResourcesController {
  async setLink(ctx: HttpContext) {
    const body = await ctx.request
      .validateUsing(setLinkValidator, { data: ctx.request.body() })
      .catch(refuseInvalidAdmissionBody);
    const command = parseAccountCommand(
      ctx.request.header('x-account-command-id'),
      ctx.request.header('idempotency-key')
    );
    const { companyId, userId } = ctx.params;
    const result = await withActor(ctx, async (currentActor, trx) => {
      let actor: Awaited<ReturnType<typeof assertCompanyPermission>>;
      return runAccountCommand(trx, {
        name: 'set-member-resource-link',
        authorizeAccess: async () => {
          actor = await assertCompanyPermission(companyId, 'members:manage', trx);
        },
        work: async () => {
          const { actorId } = actor;
          const link = await setMemberResourceLink(trx, {
            companyId,
            userId,
            resourceId: body.resourceId,
            expectedRevision: body.expectedRevision,
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
  }

  async clearLink(ctx: HttpContext) {
    const body = await ctx.request
      .validateUsing(clearLinkValidator, { data: ctx.request.body() })
      .catch(refuseInvalidAdmissionBody);
    const command = parseAccountCommand(
      ctx.request.header('x-account-command-id'),
      ctx.request.header('idempotency-key')
    );
    const { companyId, userId } = ctx.params;
    await withActor(ctx, async (currentActor, trx) => {
      let actor: Awaited<ReturnType<typeof assertCompanyPermission>>;
      return runAccountCommand(trx, {
        name: 'clear-member-resource-link',
        authorizeAccess: async () => {
          actor = await assertCompanyPermission(companyId, 'members:manage', trx);
        },
        work: async () => {
          const { actorId } = actor;
          await clearMemberResourceLink(trx, {
            companyId,
            userId,
            expectedRevision: body.expectedRevision,
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
  }
}
