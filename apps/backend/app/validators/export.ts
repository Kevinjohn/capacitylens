import vine from '@vinejs/vine'
import { REQUEST_CONTEXT_FIELDS, companyIdParam } from '#validators/request_rules'

const EXPORT_QUERY_FIELDS = ['companyId', 'includeInactive', ...REQUEST_CONTEXT_FIELDS]

/** Validates the export query without coercing values or silently dropping fields. */
export const exportQueryValidator = vine.create(
  vine
    .object({
      companyId: vine.string().regex(/\S/),
      includeInactive: vine.literal('1').optional(),
    })
    .use(
      vine.createRule((value, _options, field) => {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return
        if (Object.keys(value).some((key) => !EXPORT_QUERY_FIELDS.includes(key))) {
          field.report('Unsupported export query field.', 'unknownField', field)
        }
      })()
    )
)

/** The company export names its company in the route. */
export const showCompanyExportValidator = vine.create({
  params: vine.object({ companyId: companyIdParam() }),
})
