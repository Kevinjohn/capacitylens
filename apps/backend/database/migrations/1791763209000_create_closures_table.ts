import { BaseSchema } from '@adonisjs/lucid/schema';
import { guardCompany, retainDeletedRows, scoped } from '#database/migration_helpers';

export default class extends BaseSchema {
  protected tableName = 'closures';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      scoped(table);
      table.string('name').notNullable();
      table.date('start_date').notNullable();
      table.date('end_date').notNullable();
      table.check('start_date <= end_date');
    });
    guardCompany(this.schema, this.tableName);
    retainDeletedRows(this.schema, this.tableName);
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
