import vine from '@vinejs/vine';
import type { AppDataKey } from '@capacitylens/shared/types/entities';
import { ENTITY_FIELDS, type FieldSpec } from '@capacitylens/shared/types/entityFields';
import { fieldSchema } from './fields.js';

const validators = new Map<string, ReturnType<typeof vine.compile>>();

/**
 * Checks one complete entity row without coercing its supplied scalar values.
 *
 * @throws Vine's validation error when a field is refused.
 */
export async function assertEntityRow(table: AppDataKey, row: Record<string, unknown>) {
  // Only these discriminators affect field rules. Reuse compiled schemas while preserving
  // row-dependent color validation for external resources and the built-in client.
  const isExternalResource = table === 'resources' && row.kind === 'external';
  const isBuiltinClient = table === 'clients' && row.builtin === true;
  const cacheKey = `${table}:${isExternalResource}:${isBuiltinClient}`;
  let validator = validators.get(cacheKey);
  if (!validator) {
    const ruleContext = { kind: isExternalResource ? 'external' : '', builtin: isBuiltinClient };
    const specs: Record<string, FieldSpec> = ENTITY_FIELDS[table];
    const properties = Object.fromEntries(
      Object.entries(specs).map(([field, spec]) => [
        field,
        fieldSchema(table, field, spec, ruleContext),
      ])
    );
    validator = vine.compile(vine.object(properties));
    validators.set(cacheKey, validator);
  }
  return validator.validate(row) as Promise<Record<string, unknown>>;
}
