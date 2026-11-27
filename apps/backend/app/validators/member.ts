import vine from '@vinejs/vine'
import { ROLES, MEMBERSHIP_STATUSES } from '@capacitylens/shared/account/types'
import {
  REQUEST_CONTEXT_FIELDS,
  accountOperationHeaders,
  allowedFields,
  companyIdParam,
  userIdParam,
} from '#validators/request_rules'

const companyParams = () => vine.object({ companyId: companyIdParam() })
const memberParams = () => vine.object({ companyId: companyIdParam(), userId: userIdParam() })

export const listMembersValidator = vine.create({ params: companyParams() })

export const updateMemberTrackingValidator = vine.create(
  vine
    .object({ enabled: vine.boolean({ strict: true }), params: companyParams() })
    .use(allowedFields({ fields: ['enabled', ...REQUEST_CONTEXT_FIELDS] }))
)

export const changeRoleValidator = vine.create(
  vine
    .object({ role: vine.enum(ROLES), params: memberParams(), headers: accountOperationHeaders() })
    .use(allowedFields({ fields: ['role', ...REQUEST_CONTEXT_FIELDS] }))
)

export const changeStatusValidator = vine.create(
  vine
    .object({
      status: vine.enum(MEMBERSHIP_STATUSES),
      params: memberParams(),
      headers: accountOperationHeaders(),
    })
    .use(allowedFields({ fields: ['status', ...REQUEST_CONTEXT_FIELDS] }))
)
