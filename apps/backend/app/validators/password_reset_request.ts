import vine from '@vinejs/vine'
import { normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import { accountEmail, allowedFields } from '#validators/request_rules'

export const requestResetValidator = vine.create(
  vine
    .object({ email: vine.string().use(accountEmail()).transform(normalizeAccountEmail) })
    .use(allowedFields({ fields: ['email'] }))
)
