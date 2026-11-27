import vine from '@vinejs/vine'
import { allowedFields, bearerToken, passwordLength } from '#validators/request_rules'

export const inspectVerificationValidator = vine.create(
  vine.object({ token: vine.string().use(bearerToken()) }).use(allowedFields({ fields: ['token'] }))
)

export const completeVerificationValidator = vine.create(
  vine
    .object({
      token: vine.string().use(bearerToken()),
      password: vine.string().use(passwordLength()),
    })
    .use(allowedFields({ fields: ['token', 'password'] }))
)
