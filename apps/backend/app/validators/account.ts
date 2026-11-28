import vine from '@vinejs/vine'
import { allowedFields } from '#validators/request_rules'

export const deleteAccountValidator = vine.create(
  vine
    .object({ currentPassword: vine.string() })
    .use(allowedFields({ fields: ['currentPassword'] }))
)
