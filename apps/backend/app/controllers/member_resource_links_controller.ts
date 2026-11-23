import type { HttpContext } from '@adonisjs/core/http';
import { parseAccountOperation } from '#services/account_operations';
import { runMemberMutation } from '#services/membership/member_mutation_request';
import { clearMemberResourceLink, setMemberResourceLink } from '#services/member_resources/links';
import { refuseInvalidAdmissionBody } from '#services/admission/errors';
import { clearLinkValidator, setLinkValidator } from '#validators/member_resources';

/** Scoped member/person association. */
export default class MemberResourceLinksController {
  async update({ auth, params, request, serialize }: HttpContext) {
    const [validationError, body] = await request.tryValidateUsing(setLinkValidator, {
      data: request.body(),
    });
    if (validationError) refuseInvalidAdmissionBody(validationError);
    const command = parseAccountOperation(
      request.header('x-account-operation-id'),
      request.header('idempotency-key')
    );
    const { companyId, userId } = params;
    const result = await runMemberMutation(auth, {
      companyId,
      operation: 'set-member-resource-link',
      command,
      payload: { userId, ...body },
      work: async (trx, { actorId }) => {
        const link = await setMemberResourceLink(trx, {
          companyId,
          userId,
          resourceId: body.resourceId,
          expectedRevision: body.expectedRevision,
          actorId,
        });
        return { resourceId: link.resourceId, revision: link.revision };
      },
    });
    return serialize(result);
  }

  async destroy({ auth, params, request, response }: HttpContext) {
    const [validationError, body] = await request.tryValidateUsing(clearLinkValidator, {
      data: request.body(),
    });
    if (validationError) refuseInvalidAdmissionBody(validationError);
    const command = parseAccountOperation(
      request.header('x-account-operation-id'),
      request.header('idempotency-key')
    );
    const { companyId, userId } = params;
    await runMemberMutation(auth, {
      companyId,
      operation: 'clear-member-resource-link',
      command,
      payload: { userId, ...body },
      work: async (trx, { actorId }) => {
        await clearMemberResourceLink(trx, {
          companyId,
          userId,
          expectedRevision: body.expectedRevision,
          actorId,
        });
        return { ok: true };
      },
    });
    return response.noContent();
  }
}
