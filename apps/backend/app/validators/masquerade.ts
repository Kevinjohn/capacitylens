import vine from '@vinejs/vine';
import { REQUEST_CONTEXT_FIELDS, allowedFields, companyIdParam } from '#validators/request_rules';

/** The caller's current view-as context token; the action answers its absence. */
const masqueradeContextHeaders = () =>
  vine.object({ 'x-masquerade-context': vine.string().optional() });

export const startMasqueradeValidator = vine.create(
  vine
    .object({
      targetUserId: vine.string().minLength(1),
      params: vine.object({ companyId: companyIdParam() }),
      headers: masqueradeContextHeaders(),
    })
    .use(allowedFields({ fields: ['targetUserId', ...REQUEST_CONTEXT_FIELDS] }))
);

export const endMasqueradeValidator = vine.create(
  vine
    .object({
      token: vine.string().minLength(1),
      reason: vine.enum(['explicit', 'company_switch'] as const),
      headers: masqueradeContextHeaders(),
    })
    .use(allowedFields({ fields: ['token', 'reason', ...REQUEST_CONTEXT_FIELDS] }))
);
