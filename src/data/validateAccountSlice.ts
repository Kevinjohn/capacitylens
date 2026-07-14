import { KNOWN_KEYS, migrate } from '@capacitylens/shared/data/migrate'
import { SCOPED_KEYS, type AppData } from '@capacitylens/shared/types/entities'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Validate a complete tenant slice before migration can repair or synthesize rows. */
export function validateAccountSlice(value: unknown, accountId: string): AppData | null {
  if (!isRecord(value) || KNOWN_KEYS.some((key) => !Array.isArray(value[key]))) return null
  for (const key of KNOWN_KEYS) {
    if (!(value[key] as unknown[]).every(isRecord)) return null
  }
  const accounts = value.accounts as Array<Record<string, unknown>>
  if (accounts.length !== 1 || accounts[0].id !== accountId) return null
  for (const key of SCOPED_KEYS) {
    if (!(value[key] as Array<Record<string, unknown>>).every((row) => row.accountId === accountId)) return null
  }
  return migrate(value)
}
