import type { AppData, AppDataKey } from './entities.js';
import { buildNullableFields } from './entityFields.js';

type NullableProperties<T> = { [K in keyof T as null extends T[K] ? K : never]: null };

/** Present empty values for every nullable entity property, derived from the field table. */
export const NULLABLE_FIELDS = buildNullableFields() satisfies {
  [K in AppDataKey]: NullableProperties<AppData[K][number]>;
};

// The derived table must also hold no field the interface makes non-nullable.
type ExtraNullableField = {
  [K in AppDataKey]: Exclude<
    keyof (typeof NULLABLE_FIELDS)[K],
    keyof NullableProperties<AppData[K][number]>
  >;
}[AppDataKey];
const nullableFieldsMatchInterfaces: ExtraNullableField extends never ? true : never = true;
void nullableFieldsMatchInterfaces;

/** Fill each omitted nullable property with null without changing populated values. */
export function fillNullableFields(key: AppDataKey, record: object): void {
  for (const field of Object.keys(NULLABLE_FIELDS[key])) {
    if (Reflect.get(record, field) === undefined) Object.assign(record, { [field]: null });
  }
}
