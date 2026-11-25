import type { AppData, AppDataKey } from '@capacitylens/shared/types/entities';
import type { RowRuleContext } from '@capacitylens/shared/types/entityFieldRules';
import { buildRowValidator } from '#validators/planning/row';

/** Validates complete stored rows against their table's field specs. */
export class RowValidationService {
  /** One compiled validator per table and row-fact combination, shared by every instance. */
  static #validators = new Map<string, ReturnType<typeof buildRowValidator>>();

  /**
   * Checks one complete stored row against its table's field specs without coercing supplied scalar
   * values. Fields the table does not list are dropped from the result.
   *
   * @throws Vine's validation error when a field is refused.
   */
  async validateRow<K extends AppDataKey>(
    table: K,
    row: Record<string, unknown>
  ): Promise<AppData[K][number]> {
    // Only these row facts change a field rule, so one compiled schema serves each combination.
    const context: RowRuleContext = {
      externalResource: table === 'resources' && row.kind === 'external',
      builtinClient: table === 'clients' && row.builtin === true,
    };
    const cacheKey = `${table}:${context.externalResource}:${context.builtinClient}`;
    let validator = RowValidationService.#validators.get(cacheKey);
    if (!validator) {
      validator = buildRowValidator(table, context);
      RowValidationService.#validators.set(cacheKey, validator);
    }
    // The row was just validated against this table's field specs, which the compiler holds equal
    // to the entity interface, so it is a row of this table.
    return (await validator.validate(row)) as AppData[K][number];
  }
}
