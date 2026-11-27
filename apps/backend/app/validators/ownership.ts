import vine from '@vinejs/vine'
import {
  REQUEST_CONTEXT_FIELDS,
  USER_ID_PATTERN,
  accountOperationHeaders,
  allowedFields,
  companyIdParam,
  isSupplied,
} from '#validators/request_rules'

export const transferOwnershipValidator = vine.create(
  vine
    .object({
      toUserId: vine.string().regex(USER_ID_PATTERN),
      confirmationId: vine
        .string()
        .regex(/^[0-9a-f-]{36}$/)
        .optional()
        .requiredWhen(isSupplied),
      params: vine.object({ companyId: companyIdParam() }),
      headers: accountOperationHeaders(),
    })
    .use(allowedFields({ fields: ['toUserId', 'confirmationId', ...REQUEST_CONTEXT_FIELDS] }))
)
