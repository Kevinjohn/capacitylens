/**
 * The persisted envelope common to every SmallSass record.
 *
 * Products may add fields, but they must not replace or reinterpret these. Keeping this tiny makes
 * it safe for browser, server, migration and import code to share without pulling in a framework.
 */
export type FamilyID = string
export type FamilyISOTimestamp = string

export interface FamilyEntity {
  id: FamilyID
  createdAt: FamilyISOTimestamp
  updatedAt: FamilyISOTimestamp
}

/**
 * Every tenant-owned record carries the tenant key on the record itself. The active tenant is
 * request/UI context and is never persisted as a substitute for this field.
 */
export interface FamilyScopedEntity extends FamilyEntity {
  accountId: FamilyID
}
