import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { sourceFiles } from '@adonisjs/lucid/utils'

type SchemaIntegrity = { kind: 'ok' } | { kind: 'drift'; message: string } | { kind: 'unchecked' }

let remembered: SchemaIntegrity = { kind: 'unchecked' }

/**
 * The schema check against the migrations this build ships. The remembered outcome stays module
 * state, so every instance reads the one boot recorded.
 */
export class SchemaIntegrityService {
  #readMigrationsConfig() {
    const connection = db.getRawConnection(db.primaryConnectionName)
    if (!connection) throw new Error(`Database connection ${db.primaryConnectionName} is missing`)
    return connection.config.migrations ?? {}
  }

  /**
   * The migrations shipped with this build, named as Lucid records them in `adonis_schema`: read
   * from the configured migration directories the way Lucid's migrator reads them.
   */
  async #listShippedMigrations() {
    const config = this.#readMigrationsConfig()
    const directories = config.paths?.length
      ? config.paths
      : [`./${app.relativePath(app.migrationsPath())}`]
    const sources = await Promise.all(
      directories.map((directory) =>
        sourceFiles(app.appRoot, directory, config.naturalSort ?? false)
      )
    )
    return sources.flatMap(({ files }) => files.map((file) => file.name))
  }

  /**
   * Refuses a database that has not recorded every migration shipped with the running build, such
   * as an older backup restored under newer code. Migrations are the only writer of the schema, so
   * the record is the one fact checked; tables, columns, indexes and triggers are not compared.
   */
  async assertSchemaIntegrity() {
    const shipped = await this.#listShippedMigrations()
    if (shipped.length === 0) {
      throw new Error('Database schema drift: this build ships no migrations to compare')
    }
    const tableName = this.#readMigrationsConfig().tableName ?? 'adonis_schema'
    if (!(await db.connection().schema.hasTable(tableName))) {
      throw new Error('Database schema drift: the migration record is missing')
    }
    const rows = (await db.from(tableName).select('name')) as Array<{ name: unknown }>
    const recorded = new Set(rows.map((row) => String(row.name)))
    const unrecorded = shipped.filter((name) => !recorded.has(name))
    if (unrecorded.length > 0) {
      throw new Error(
        `Database schema drift: shipped migrations are not recorded (${unrecorded.join(', ')})`
      )
    }
  }

  /**
   * Runs {@link SchemaIntegrityService.assertSchemaIntegrity} and keeps the outcome for readiness probes, then rethrows a
   * failure. Boot calls it; the database is only replaced while the server is stopped.
   */
  async rememberSchemaIntegrity() {
    try {
      await this.assertSchemaIntegrity()
      remembered = { kind: 'ok' }
    } catch (error) {
      remembered = {
        kind: 'drift',
        message: error instanceof Error ? error.message : String(error),
      }
      throw error
    }
  }

  /** The outcome of the last {@link SchemaIntegrityService.rememberSchemaIntegrity}; `unchecked` until boot runs it. */
  readSchemaIntegrity(): SchemaIntegrity {
    return remembered
  }
}
