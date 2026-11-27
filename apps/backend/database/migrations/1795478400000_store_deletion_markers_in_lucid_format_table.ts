import { BaseSchema } from '@adonisjs/lucid/schema'

/** The planning tables whose rows carry a soft-delete marker. */
const retained = ['allocations', 'time_off', 'closures', 'phases', 'disciplines'] as const

/**
 * Converts ISO soft-delete markers to Lucid's SQLite date-time format. Existing Lucid markers
 * and live rows are untouched; the conversion discards fractional seconds and cannot be undone.
 */
export default class extends BaseSchema {
  protected tableName = 'deleted_rows'

  async up() {
    this.defer(async (db) => {
      for (const table of retained) {
        await db
          .from(table)
          .whereLike('deleted_at', '%T%')
          .update({ deleted_at: db.raw(`strftime('%Y-%m-%d %H:%M:%S', deleted_at)`) })
      }
    })
  }
  /** Refuses rollback because conversion discards the original marker precision. */
  async down() {
    throw new Error('This migration cannot be reversed')
  }
}
