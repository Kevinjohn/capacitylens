import { BaseSchema } from '@adonisjs/lucid/schema';
import { guardCompany, retainDeletedRows, scoped } from '#database/migration_helpers';

export default class extends BaseSchema {
  protected tableName = 'phases';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      scoped(table);
      table.string('name').notNullable();
      table
        .string('project_id')
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE');
      table.index(['project_id']);
    });
    guardCompany(this.schema, this.tableName, [['project_id', 'projects']]);
    retainDeletedRows(this.schema, this.tableName);
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
