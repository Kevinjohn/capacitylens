import vine from '@vinejs/vine'
import { userIdParam } from '#validators/request_rules'

/** Unknown query fields remain ignored; cursor is opaque and may be empty. */
export const admissionQueryValidator = vine.create({
  status: vine.enum(['pending', 'approved', 'rejected', 'revoked']).optional(),
  cursor: vine
    .string()
    .use(
      vine.createRule((value, _options, field) => {
        if (typeof value === 'string' && value.length > 512) {
          field.report('Invalid cursor.', 'cursorLength', field)
        }
      })()
    )
    .optional(),
})

/** An Owner or Admin's admission decision names the account in its route. */
export const decideAdmissionValidator = vine.create({
  params: vine.object({ userId: userIdParam() }),
})
