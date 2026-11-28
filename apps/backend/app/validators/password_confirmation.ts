import vine from '@vinejs/vine'
import { allowedFields } from '#validators/request_rules'

/** Each action names its own intent; the import document keeps its own parser in the controller. */
export const confirmPasswordValidator = vine.create(
  vine
    .object({
      companyId: vine.string().minLength(1),
      password: vine.string(),
    })
    .merge(
      vine.group([
        vine.group.if((data) => data.action === 'transfer-ownership', {
          action: vine.literal('transfer-ownership'),
          intent: vine
            .object({ toUserId: vine.string().minLength(1) })
            .use(allowedFields({ fields: ['toUserId'] })),
        }),
        vine.group.if((data) => data.action === 'import', {
          action: vine.literal('import'),
          intent: vine
            .object({
              baseRevision: vine
                .number({ strict: true })
                .withoutDecimals()
                .min(0)
                .max(Number.MAX_SAFE_INTEGER),
              document: vine.any().nullable(),
            })
            .use(allowedFields({ fields: ['baseRevision', 'document'] })),
        }),
        vine.group.else({
          action: vine.literal('anonymise'),
          intent: vine.object({}).use(allowedFields({ fields: [] })),
        }),
      ])
    )
    .use(allowedFields({ fields: ['action', 'companyId', 'intent', 'password'] }))
)
