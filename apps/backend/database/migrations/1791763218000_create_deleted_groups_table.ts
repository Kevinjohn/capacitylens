import { BaseSchema } from '@adonisjs/lucid/schema';
import { retained } from '#database/migration_helpers';

/**
 * A group is one sign-in's server-side before-image of a typed delete; restore consumes it once.
 * Ending that sign-in deletes the group, so before-images never outlive the session.
 */
export default class extends BaseSchema {
  protected tableName = 'deleted_groups';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('group_id').primary();
      table
        .string('company_id')
        .notNullable()
        .references('id')
        .inTable('companies')
        .onDelete('CASCADE');
      table.string('actor_id').notNullable();
      table
        .integer('session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('account_sessions')
        .onDelete('CASCADE');
      table.string('mutation_id').notNullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('consumed_at').nullable();
      table.index(['company_id']);
      table.index(['session_id']);
    });
    this.schema.raw(
      `CREATE TRIGGER deleted_groups_active_row_abort BEFORE DELETE ON deleted_groups WHEN ${retained.map((name) => `EXISTS (SELECT 1 FROM ${name} WHERE deletion_group_id = OLD.group_id AND deleted_at IS NULL)`).join(' OR ')} BEGIN SELECT RAISE(ABORT, 'active row cannot belong to deletion group'); END`
    );
    this.schema.raw(
      "CREATE TRIGGER deleted_groups_company_immutable BEFORE UPDATE OF company_id ON deleted_groups WHEN NEW.company_id <> OLD.company_id BEGIN SELECT RAISE(ABORT, 'company_id is immutable'); END"
    );
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
