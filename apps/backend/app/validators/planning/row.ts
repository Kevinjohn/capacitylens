import vine from '@vinejs/vine';
import type { AppData, AppDataKey } from '@capacitylens/shared/types/entities';
import { ENTITY_FIELDS, type FieldSpec } from '@capacitylens/shared/types/entityFields';
import { findFieldProblem, type RowRuleContext } from '#validators/planning/fields';

const rowField = vine.createRule<{ field: string; spec: FieldSpec; context: RowRuleContext }>(
  (value, { field, spec, context }, ctx) => {
    const problem = findFieldProblem(field, spec, value, context);
    if (problem) ctx.report(problem.message, problem.rule, ctx);
  },
  { name: 'entityField', implicit: true }
);

const validators = new Map<string, ReturnType<typeof vine.compile>>();

/**
 * Checks one complete stored row against its table's field specs without coercing supplied scalar
 * values. Fields the table does not list are dropped from the result.
 *
 * @throws Vine's validation error when a field is refused.
 */
export async function validateRow<K extends AppDataKey>(
  table: K,
  row: Record<string, unknown>
): Promise<AppData[K][number]> {
  // Only these row facts change a field rule, so one compiled schema serves each combination.
  const context: RowRuleContext = {
    externalResource: table === 'resources' && row.kind === 'external',
    builtinClient: table === 'clients' && row.builtin === true,
  };
  const cacheKey = `${table}:${context.externalResource}:${context.builtinClient}`;
  let validator = validators.get(cacheKey);
  if (!validator) {
    const specs: Record<string, FieldSpec> = ENTITY_FIELDS[table];
    const properties = Object.fromEntries(
      Object.entries(specs).map(([field, spec]) => [
        field,
        vine.any().optional().use(rowField({ field, spec, context })),
      ])
    );
    validator = vine.compile(vine.object(properties));
    validators.set(cacheKey, validator);
  }
  // The row was just validated against this table's field specs, which the compiler holds equal
  // to the entity interface, so it is a row of this table.
  return (await validator.validate(row)) as AppData[K][number];
}
