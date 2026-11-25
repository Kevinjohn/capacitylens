import vine from '@vinejs/vine';
import { companyIdParam } from '#validators/request_rules';

export const showGettingStartedValidator = vine.create(
  vine.object({ params: vine.object({ companyId: companyIdParam() }) })
);

export const updateGettingStartedValidator = vine.create(
  vine.object({
    dismissed: vine.literal(true),
    params: vine.object({ companyId: companyIdParam() }),
  })
);
