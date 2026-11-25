import vine from '@vinejs/vine';
import {
  REQUEST_CONTEXT_FIELDS,
  accountOperationHeaders,
  allowedFields,
  companyIdParam,
  userIdParam,
} from '#validators/request_rules';

const memberParams = () => vine.object({ companyId: companyIdParam(), userId: userIdParam() });

export const setLinkValidator = vine.create(
  vine
    .object({
      resourceId: vine.string().minLength(1),
      expectedRevision: vine.string().nullable(),
      params: memberParams(),
      headers: accountOperationHeaders(),
    })
    .use(allowedFields({ fields: ['resourceId', 'expectedRevision', ...REQUEST_CONTEXT_FIELDS] }))
);

export const clearLinkValidator = vine.create(
  vine
    .object({
      expectedRevision: vine.string().minLength(1),
      params: memberParams(),
      headers: accountOperationHeaders(),
    })
    .use(allowedFields({ fields: ['expectedRevision', ...REQUEST_CONTEXT_FIELDS] }))
);
