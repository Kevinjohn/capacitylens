import vine from '@vinejs/vine';
import { allowedFields } from '#validators/request_rules';

export const anonymiseResourceValidator = vine.create(
  vine.object({}).use(allowedFields({ fields: [] }))
);

export const anonymiseCompanyValidator = vine.create(
  vine.object({ confirmationId: vine.string() }).use(allowedFields({ fields: ['confirmationId'] }))
);
