import vine from '@vinejs/vine'
import { REQUEST_CONTEXT_FIELDS, allowedFields, isSupplied } from '#validators/request_rules'

// The document keeps its own parser and error type; the validator only requires the key.
export const previewImportValidator = vine.create(
  vine
    .object({ companyId: vine.string().minLength(1), document: vine.any().nullable() })
    .use(allowedFields({ fields: ['companyId', 'document', ...REQUEST_CONTEXT_FIELDS] }))
)

export const applyImportValidator = vine.create(
  vine
    .object({
      companyId: vine.string().minLength(1),
      document: vine.any().nullable(),
      baseRevision: vine
        .number({ strict: true })
        .withoutDecimals()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER),
      confirmationId: vine.string().optional().requiredWhen(isSupplied),
    })
    .use(
      allowedFields({
        fields: [
          'companyId',
          'document',
          'baseRevision',
          'confirmationId',
          ...REQUEST_CONTEXT_FIELDS,
        ],
      })
    )
)
