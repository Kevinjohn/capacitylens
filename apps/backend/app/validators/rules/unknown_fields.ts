import vine from '@vinejs/vine'

type AllowedFields = readonly string[] | ((value: Record<string, unknown>) => readonly string[])

/** Reject extra keys at the Vine object boundary, including nested command objects. */
export const rejectUnknownFields = vine.createRule<AllowedFields>(
  (value, allowed, field) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return
    const object = value as Record<string, unknown>
    const names = typeof allowed === 'function' ? allowed(object) : allowed
    const unknown = Object.keys(object).filter((name) => !names.includes(name))
    if (unknown.length)
      field.report(`Unknown field(s): ${unknown.join(', ')}.`, 'unknownFields', field)
  },
  { name: 'unknownFields' }
)
