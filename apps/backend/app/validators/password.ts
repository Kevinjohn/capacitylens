import vine from '@vinejs/vine'
import { allowedFields, passwordLength } from '#validators/request_rules'

export const changePasswordValidator = vine.create(
  vine
    .object({
      currentPassword: vine.string(),
      newPassword: vine.string().use(passwordLength()),
    })
    .use(allowedFields({ fields: ['currentPassword', 'newPassword'] }))
)
