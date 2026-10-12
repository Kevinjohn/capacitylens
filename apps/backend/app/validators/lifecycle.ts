import vine from '@vinejs/vine'
import { rejectUnknownFields } from '#validators/rules/unknown_fields'

export const lifecycleValidator = vine.compile(
  vine
    .object({ accountId: vine.string().trim().minLength(1) })
    .use(rejectUnknownFields(['accountId']))
)
