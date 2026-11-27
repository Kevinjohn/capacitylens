import { BaseSchema } from '@adonisjs/lucid/schema';
import { guardCompany, scoped } from '#database/migration_helpers';

export default class extends BaseSchema {
  protected tableName = 'activities';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      scoped(table);
      table.string('name').notNullable();
      table.string('kind').notNullable();
      table
        .string('project_id')
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE');
      table.string('phase_id').nullable().references('id').inTable('phases').onDelete('SET NULL');
      table.timestamp('archived_at').nullable();
      table.index(['project_id']);
      table.index(['phase_id']);
      table.check("kind IN ('project','internal','allProjects')");
    });
    guardCompany(this.schema, this.tableName, [
      ['project_id', 'projects'],
      ['phase_id', 'phases'],
    ]);
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
