import vine from '@vinejs/vine'
import { companyIdParam } from '#validators/request_rules'

export const showGettingStartedValidator = vine.create({
  params: vine.object({ companyId: companyIdParam() }),
})

export const updateGettingStartedValidator = vine.create({
  dismissed: vine.literal(true),
  params: vine.object({ companyId: companyIdParam() }),
})
