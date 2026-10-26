import vine from '@vinejs/vine'

/** Validates the export query without coercing values or silently dropping fields. */
export const exportQueryValidator = vine.compile(
  vine
    .object({
      accountId: vine.string().regex(/\S/).optional(),
      includeInactive: vine.literal('1').optional(),
    })
    .use(
      vine.createRule((value, _options, field) => {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return
        if (Object.keys(value).some((key) => key !== 'accountId' && key !== 'includeInactive'))
          field.report('Unsupported export query field.', 'unknownField', field)
      })()
    )
)
