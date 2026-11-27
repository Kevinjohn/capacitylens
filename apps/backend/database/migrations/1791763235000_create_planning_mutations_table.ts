import { BaseSchema } from '@adonisjs/lucid/schema';

export default class extends BaseSchema {
  protected tableName = 'planning_mutations';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table
        .string('company_id')
        .notNullable()
        .references('id')
        .inTable('companies')
        .onDelete('CASCADE');
      table.string('mutation_id').notNullable();
      table.string('actor_id').notNullable();
      table.integer('revision').notNullable();
      table.primary(['company_id', 'mutation_id']);
      table.check('revision >= 0');
      table.string('restoration_group_id').nullable();
      // The sign-in that may restore; no foreign key, so the marker outlives that sign-in.
      table.integer('origin_session_id').nullable();
      table.index(['company_id', 'actor_id', 'origin_session_id', 'restoration_group_id']);
    });
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
