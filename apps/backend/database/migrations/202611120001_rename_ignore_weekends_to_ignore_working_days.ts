import { BaseSchema } from '@adonisjs/lucid/schema';

/**
 * The override skips the effective working week, not only weekends, so the column takes the name
 * of its **Ignore working days** label.
 */
export default class extends BaseSchema {
  protected tableName = 'allocations';

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('ignore_weekends', 'ignore_working_days');
    });
  }
}
