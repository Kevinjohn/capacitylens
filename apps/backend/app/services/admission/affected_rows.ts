/** Normalizes Lucid's dialect-specific update/delete affected-row result. */
export function affectedRows(value: unknown): number {
  if (typeof value === 'number') return value
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'number') return value[0]
  return 0
}
