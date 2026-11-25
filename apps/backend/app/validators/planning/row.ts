import vine from '@vinejs/vine';
import type { AppDataKey } from '@capacitylens/shared/types/entities';
import { ENTITY_FIELDS, type FieldSpec } from '@capacitylens/shared/types/entityFields';
import { findFieldProblem, type RowRuleContext } from '@capacitylens/shared/types/entityFieldRules';

const rowField = vine.createRule<{ field: string; spec: FieldSpec; context: RowRuleContext }>(
  (value, { field, spec, context }, ctx) => {
    const problem = findFieldProblem(field, spec, value, context);
    if (problem) ctx.report(problem.message, problem.rule, ctx);
  },
  { name: 'entityField', implicit: true }
);

/**
 * Compiles the validator for one complete stored row of `table` under `context`. It checks each
 * field the table lists without coercing supplied scalar values and drops fields the table does
 * not list.
 */
export function buildRowValidator(table: AppDataKey, context: RowRuleContext) {
  const specs: Record<string, FieldSpec> = ENTITY_FIELDS[table];
  const properties = Object.fromEntries(
    Object.entries(specs).map(([field, spec]) => [
      field,
      vine.any().optional().use(rowField({ field, spec, context })),
    ])
  );
  return vine.create(vine.object(properties));
}
