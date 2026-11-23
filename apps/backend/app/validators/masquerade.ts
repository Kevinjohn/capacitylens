import vine from '@vinejs/vine';
import { allowedFields } from '#validators/request_rules';

export const startMasqueradeValidator = vine.create(
  vine
    .object({ targetUserId: vine.string().minLength(1) })
    .use(allowedFields({ fields: ['targetUserId'] }))
);

export const endMasqueradeValidator = vine.create(
  vine
    .object({
      token: vine.string().minLength(1),
      reason: vine.enum(['explicit', 'company_switch'] as const),
    })
    .use(allowedFields({ fields: ['token', 'reason'] }))
);
