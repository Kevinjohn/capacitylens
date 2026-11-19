import vine from '@vinejs/vine';
import { ACCOUNT_ROLES, MEMBERSHIP_STATUSES } from '@capacitylens/shared/account/types';
import { allowedFields, fixedMessage } from '#validators/request_rules';

const trackingMessage = 'enabled must be a Boolean.';
export const trackingValidator = vine.compile(
  vine
    .object({ enabled: vine.boolean({ strict: true }) })
    .use(allowedFields({ fields: ['enabled'], message: trackingMessage }))
);
trackingValidator.messagesProvider = fixedMessage(trackingMessage);

const changeRoleMessage = 'Invalid member role.';
export const changeRoleValidator = vine.compile(
  vine
    .object({ role: vine.enum(ACCOUNT_ROLES) })
    .use(allowedFields({ fields: ['role'], message: changeRoleMessage }))
);
changeRoleValidator.messagesProvider = fixedMessage(changeRoleMessage);

const changeStatusMessage = 'Invalid member status.';
export const changeStatusValidator = vine.compile(
  vine
    .object({ status: vine.enum(MEMBERSHIP_STATUSES) })
    .use(allowedFields({ fields: ['status'], message: changeStatusMessage }))
);
changeStatusValidator.messagesProvider = fixedMessage(changeStatusMessage);
