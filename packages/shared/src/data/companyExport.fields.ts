import { APP_DATA_KEYS } from '../types/entityKeys.js';
import type { AppDataKey } from '../types/entities.js';
import { ENTITY_FIELDS } from '../types/entityFields.js';

function buildFields() {
  const fields: Partial<Record<AppDataKey, readonly string[]>> = {};
  for (const key of APP_DATA_KEYS) fields[key] = Object.keys(ENTITY_FIELDS[key]);
  // The loop above fills every key of APP_DATA_KEYS.
  return fields as Record<AppDataKey, readonly string[]>;
}

/** Every portable field of each export table: every stored field in the entity field table. */
export const FIELDS = buildFields();

/** One untrusted export row, read field by field. */
export type Row = Record<string, unknown>;
