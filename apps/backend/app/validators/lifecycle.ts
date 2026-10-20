import vine from '@vinejs/vine'

export const lifecycleValidator = vine.compile(
  vine.object({ accountId: vine.string().trim().minLength(1) })
)
