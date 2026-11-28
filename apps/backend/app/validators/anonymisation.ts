import vine from '@vinejs/vine'
import { entityId } from '#validators/planning/fields'
import { REQUEST_CONTEXT_FIELDS, allowedFields, companyIdParam } from '#validators/request_rules'

export const anonymiseResourceValidator = vine.create(
  vine
    .object({ params: vine.object({ companyId: companyIdParam(), id: entityId() }) })
    .use(allowedFields({ fields: REQUEST_CONTEXT_FIELDS }))
)

export const anonymiseCompanyValidator = vine.create(
  vine
    .object({
      confirmationId: vine.string(),
      params: vine.object({ companyId: companyIdParam() }),
    })
    .use(allowedFields({ fields: ['confirmationId', ...REQUEST_CONTEXT_FIELDS] }))
)
