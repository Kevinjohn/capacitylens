import { BaseSchema } from '@adonisjs/lucid/schema';
import { metadata } from '#database/migration_helpers';

export default class extends BaseSchema {
  protected tableName = 'account_member_resources';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      metadata(table);
      table.string('company_id').notNullable();
      table.string('user_id').notNullable();
      table.string('resource_id').notNullable();
      table.string('revision').notNullable();
      table.unique(['company_id', 'user_id']);
      table.unique(['company_id', 'resource_id']);
    });
    // A resource that stops being a person loses its member link.
    this.schema.raw(
      "CREATE TRIGGER capacitylens_member_resource_kind_cleanup AFTER UPDATE OF kind ON resources WHEN OLD.kind = 'person' AND NEW.kind <> 'person' BEGIN DELETE FROM account_member_resources WHERE company_id = OLD.company_id AND resource_id = OLD.id; END"
    );
  }

  async down() {
    this.schema.raw('DROP TRIGGER capacitylens_member_resource_kind_cleanup');
    this.schema.dropTable(this.tableName);
  }
}
