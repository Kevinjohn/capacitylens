import { BaseSchema } from '@adonisjs/lucid/schema';

/** The planning tables whose rows carry a soft-delete marker. */
const retained = ['allocations', 'time_off', 'closures', 'phases', 'disciplines'] as const;

/**
 * Older releases stored some `deleted_at` markers as UTC ISO strings. The models now read the
 * marker in Lucid's own SQLite date-time format only (#2442), so rewrite those markers in place.
 * Rows already in Lucid's format and live rows are untouched.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      for (const table of retained) {
        await db
          .from(table)
          .whereLike('deleted_at', '%T%')
          .update({ deleted_at: db.raw(`strftime('%Y-%m-%d %H:%M:%S', deleted_at)`) });
      }
    });
  }
}
