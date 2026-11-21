import { test } from '@japa/runner';
import { APP_DATA_KEYS, type AppData } from '@capacitylens/shared/types/entities';
import { transformState } from '#transformers/state_transformer';
import { assertMayWriteRestrictedFields } from '#services/planning/entity_rules';
import { PlanningOperationError } from '#services/planning/errors';
import { RESTRICTED_FIELDS } from '#services/planning/restricted_fields';
import type { PlanningAccessGrant } from '#services/planning/access_grant';

// An Editor sees neither private names nor time-off notes.
const editor = {
  role: 'editor',
  canSeePrivateNames: false,
  canSeeTimeOffNote: false,
} as unknown as PlanningAccessGrant;

const secretRow = (fields: readonly string[]) => ({
  id: 'row-1',
  companyId: 'a-gotham',
  isPrivate: true,
  ...Object.fromEntries(fields.map((field) => [field, `SECRET ${field}`])),
});

test.group('restricted fields', () => {
  for (const [table, rule] of Object.entries(RESTRICTED_FIELDS)) {
    const key = table as keyof typeof RESTRICTED_FIELDS;
    const declared = [...rule!.fields, ...rule!.privateRowFields];

    test(`${table}: the read projection never sends a declared field's stored value`, ({
      assert,
    }) => {
      const data = Object.fromEntries(
        APP_DATA_KEYS.map((name) => [name, []])
      ) as unknown as AppData;
      (data[key] as unknown[]) = [secretRow(declared)];
      const [row] = transformState(data, 'a-gotham', 'editor')[key] as unknown as Array<
        Record<string, unknown>
      >;
      for (const field of declared) {
        if (rule!.shownOnRead.includes(field)) continue;
        assert.notEqual(row![field], `SECRET ${field}`, `${table}.${field}`);
      }
    });

    test(`${table}: a write naming a declared field is refused`, ({ assert }) => {
      for (const field of rule!.fields) {
        for (const mode of ['create', 'update'] as const) {
          let refused: unknown;
          try {
            assertMayWriteRestrictedFields(key, { [field]: `SECRET ${field}` }, editor, mode);
          } catch (error) {
            refused = error;
          }
          assert.instanceOf(refused, PlanningOperationError, `${table}.${field} ${mode}`);
        }
      }
    });
  }
});
