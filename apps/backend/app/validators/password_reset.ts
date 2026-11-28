import vine from '@vinejs/vine'
import { allowedFields, bearerToken, passwordLength } from '#validators/request_rules'

export const inspectResetValidator = vine.create(
  vine.object({ token: vine.string().use(bearerToken()) }).use(allowedFields({ fields: ['token'] }))
)

export const resetPasswordValidator = vine.create(
  vine
    .object({
      token: vine.string().use(bearerToken()),
      newPassword: vine.string().use(passwordLength()),
    })
    .use(allowedFields({ fields: ['token', 'newPassword'] }))
)
