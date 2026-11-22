import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { assertCompanyPermission } from '#services/auth/authorization';
import { runAccountOperation, parseAccountOperation } from '#services/account_operations';
import { clearMemberResourceLink, setMemberResourceLink } from '#services/member_resources/links';
import { refuseInvalidAdmissionBody } from '#services/admission/errors';
import { clearLinkValidator, setLinkValidator } from '#validators/member_resources';

/** Scoped member/person association. */
export default class MemberResourceLinksController {
  async update(ctx: HttpContext) {
    const [validationError, body] = await ctx.request.tryValidateUsing(setLinkValidator, {
      data: ctx.request.body(),
    });
    if (validationError) refuseInvalidAdmissionBody(validationError);
    const command = parseAccountOperation(
      ctx.request.header('x-account-operation-id'),
      ctx.request.header('idempotency-key')
    );
    const { companyId, userId } = ctx.params;
    const result = await withActor(ctx, async (currentActor, trx) => {
      let actor: Awaited<ReturnType<typeof assertCompanyPermission>>;
      return runAccountOperation(trx, {
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
    return ctx.serialize(result);
  }

  async destroy(ctx: HttpContext) {
    const [validationError, body] = await ctx.request.tryValidateUsing(clearLinkValidator, {
      data: ctx.request.body(),
    });
    if (validationError) refuseInvalidAdmissionBody(validationError);
    const command = parseAccountOperation(
      ctx.request.header('x-account-operation-id'),
      ctx.request.header('idempotency-key')
    );
    const { companyId, userId } = ctx.params;
    await withActor(ctx, async (currentActor, trx) => {
      let actor: Awaited<ReturnType<typeof assertCompanyPermission>>;
      return runAccountOperation(trx, {
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
