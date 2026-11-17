// Public entry for the core domain types, table keys and entity helpers.
export * from './entityTypes.js';

export {
  APP_DATA_KEYS,
  SCOPED_KEYS,
  APP_DATA_WRITE_ORDER,
  SCOPED_WRITE_ORDER,
  FULL_DAY_HOURS,
  MAX_HOURS_PER_DAY,
} from './entityKeys.js';
export type { AppDataKey, ScopedEntityKey } from './entityKeys.js';

/** Portable JSON schema version, independent of the physical SQLite schema version.
 * Increment when the portable AppData shape changes and provide the corresponding migration. */
export const EXPORT_SCHEMA_VERSION = 25;

export {
  carriesHourlyLoad,
  isScopedEntityKey,
  scopedTables,
  clampHoursPerDay,
  clampWorkingHoursPerDay,
  isExternalResource,
  isCapacityTracked,
  hasPersonalWorkingPattern,
  isPlaceholderResource,
  externalCapacityDefaults,
  placeholderCapacityDefaults,
  emptyAppData,
} from './entityHelpers.js';
