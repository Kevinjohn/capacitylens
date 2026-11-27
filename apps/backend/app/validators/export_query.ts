import vine from '@vinejs/vine'
import { companyIdParam } from '#validators/request_rules'

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
        if (Object.keys(value).some((key) => key !== 'companyId' && key !== 'includeInactive')) {
          field.report('Unsupported export query field.', 'unknownField', field)
        }
      })()
    )
)

/** The company export names its company in the route. */
export const showCompanyExportValidator = vine.create(
  vine.object({ params: vine.object({ companyId: companyIdParam() }) })
)
