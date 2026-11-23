import vine from '@vinejs/vine';
import { ROLES, MEMBERSHIP_STATUSES } from '@capacitylens/shared/account/types';
import { allowedFields } from '#validators/request_rules';

export const updateMemberTrackingValidator = vine.create(
  vine
    .object({ enabled: vine.boolean({ strict: true }) })
    .use(allowedFields({ fields: ['enabled'] }))
);

export const changeRoleValidator = vine.create(
  vine.object({ role: vine.enum(ROLES) }).use(allowedFields({ fields: ['role'] }))
);

export const changeStatusValidator = vine.create(
  vine.object({ status: vine.enum(MEMBERSHIP_STATUSES) }).use(allowedFields({ fields: ['status'] }))
);
