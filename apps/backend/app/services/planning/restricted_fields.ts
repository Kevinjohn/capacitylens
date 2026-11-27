import type { Client, Project, ScopedEntityKey } from '@capacitylens/shared/types/entities'
import { redactPrivateName } from '@capacitylens/shared/domain/privateNames'
import type { PlanningAccessGrant } from '#services/planning/access_grant'

type RestrictionFlag = 'canSeePrivateNames' | 'canSeeTimeOffNote'

/** Fields a role without the named visibility flag may neither see nor change. */
export interface RestrictedFieldRule {
  flag: RestrictionFlag
  /** Hidden on every row of the table. */
  fields: readonly string[]
  /** Hidden only on a row marked private (`isPrivate: true`). */
  privateRowFields: readonly string[]
  /** Hidden fields the read projection still sends, because the browser needs them. */
  shownOnRead: readonly string[]
  /** A create may send these fields empty (`null`, `false`) without the flag. */
  emptyAllowedOnCreate: boolean
  refusal: string
}

const PRIVATE_NAME_RULE: RestrictedFieldRule = {
  flag: 'canSeePrivateNames',
  fields: ['isPrivate', 'codeName'],
  privateRowFields: ['name'],
  shownOnRead: ['isPrivate'],
  emptyAllowedOnCreate: true,
  refusal: 'Only an owner can change private names.',
}

/** The one declaration of restricted fields; every read and write path derives from it. */
export const RESTRICTED_FIELDS: Partial<Record<ScopedEntityKey, RestrictedFieldRule>> = {
  clients: PRIVATE_NAME_RULE,
  projects: PRIVATE_NAME_RULE,
  timeOff: {
    flag: 'canSeeTimeOffNote',
    fields: ['note'],
    privateRowFields: [],
    shownOnRead: [],
    emptyAllowedOnCreate: false,
    refusal: 'The time-off note is restricted.',
  },
}

type VisibilityFlags = Pick<PlanningAccessGrant, RestrictionFlag>

/** The table's rule when the caller lacks its flag; otherwise nothing is restricted. */
export function getRestriction(table: ScopedEntityKey, flags: VisibilityFlags) {
  const rule = RESTRICTED_FIELDS[table]
  return rule && !flags[rule.flag] ? rule : undefined
}

/** Whether the caller is restricted on this stored row's private fields. */
export function isPrivateRowRestricted(
  table: ScopedEntityKey,
  flags: VisibilityFlags,
  existing: Record<string, unknown> | undefined
) {
  const rule = getRestriction(table, flags)
  return Boolean(rule && rule.privateRowFields.length > 0 && existing?.isPrivate === true)
}

/** The fields this caller cannot see on this row. */
export function listHiddenFields(
  table: ScopedEntityKey,
  flags: VisibilityFlags,
  existing: Record<string, unknown> | undefined
): readonly string[] {
  const rule = getRestriction(table, flags)
  if (!rule) return []
  return existing?.isPrivate === true ? [...rule.fields, ...rule.privateRowFields] : rule.fields
}

/**
 * Removes what this caller may not see from a stored row, for the read projection. A table with
 * private rows is first redacted by `redactPrivateName`, which shows the code name as the name.
 */
export function projectForReader<T extends object>(
  table: ScopedEntityKey,
  flags: VisibilityFlags,
  row: T
): T {
  const rule = getRestriction(table, flags)
  if (!rule) return row
  // Only clients and projects have private-row fields, so a row reaching redaction is one of them.
  let projected = (
    rule.privateRowFields.length > 0 ? redactPrivateName(row as T & (Client | Project)) : row
  ) as Record<string, unknown>
  for (const field of rule.fields) {
    if (rule.shownOnRead.includes(field)) continue
    if (projected[field] !== null && projected[field] !== undefined) {
      projected = { ...projected, [field]: null }
    }
  }
  return projected as T
}

/**
 * The reader's label for a client or project, used to order lists: a non-empty code name the
 * reader received, otherwise the name. A non-Owner receives no code name, only the quoted code name
 * as `name`.
 */
export function resolveDisplayName(row: { name: string; codeName?: string | null }): string {
  const codeName = row.codeName?.trim()
  return codeName === undefined || codeName === '' ? row.name : codeName
}
