import { BaseSchema } from '@adonisjs/lucid/schema';

const retained = ['allocations', 'time_off', 'closures', 'phases', 'disciplines'] as const;

export default class extends BaseSchema {
  async up() {
    for (const name of retained) {
      // SQLite can add a nullable reference without rebuilding the existing table. Keeping
      // the table in place preserves its established foreign-key cascade order and triggers.
      this.schema.raw(`ALTER TABLE ${name} ADD COLUMN deleted_at TIMESTAMP`);
      this.schema.raw(
        `ALTER TABLE ${name} ADD COLUMN deletion_group_id VARCHAR REFERENCES deleted_groups(group_id) ON DELETE CASCADE`
      );
      this.schema.raw(`CREATE INDEX ${name}_deletion_group_id_index ON ${name}(deletion_group_id)`);
      for (const operation of ['INSERT', 'UPDATE'])
        this.schema.raw(
          `CREATE TRIGGER ${name}_deletion_group_${operation.toLowerCase()} BEFORE ${operation} ON ${name} WHEN NEW.deletion_group_id IS NOT NULL AND (NEW.deleted_at IS NULL OR NOT EXISTS (SELECT 1 FROM deleted_groups WHERE group_id = NEW.deletion_group_id AND account_id = NEW.account_id)) BEGIN SELECT RAISE(ABORT, 'invalid deletion group association'); END`
        );
    }
    this.schema.raw(
      `CREATE TRIGGER deleted_groups_active_row_guard BEFORE DELETE ON deleted_groups WHEN ${retained.map((name) => `EXISTS (SELECT 1 FROM ${name} WHERE deletion_group_id = OLD.group_id AND deleted_at IS NULL)`).join(' OR ')} BEGIN SELECT RAISE(ABORT, 'active row cannot belong to deletion group'); END`
    );
    this.schema.raw(
      "CREATE TRIGGER deleted_groups_account_immutable BEFORE UPDATE OF account_id ON deleted_groups WHEN NEW.account_id <> OLD.account_id BEGIN SELECT RAISE(ABORT, 'account_id is immutable'); END"
    );
  }
}
