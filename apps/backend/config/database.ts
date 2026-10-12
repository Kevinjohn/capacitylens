import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'
import env from '#start/env'

const dbConfig = defineConfig({
  /**
   * Default connection used for all queries.
   */
  connection: 'sqlite',

  connections: {
    /**
     * SQLite connection (default).
     */
    sqlite: {
      client: 'better-sqlite3',

      connection: {
        filename: env.get('CAPACITYLENS_DB') ?? app.tmpPath('db.sqlite3'),
      },

      /**
       * Required by Knex for SQLite defaults.
       */
      useNullAsDefault: true,
      pool: {
        min: 1,
        max: 1,
        validate(connection) {
          return connection.open && !connection.inTransaction
        },
        afterCreate(connection, done) {
          try {
            connection.pragma('journal_mode = WAL')
            connection.pragma('synchronous = FULL')
            connection.pragma('foreign_keys = ON')
            connection.pragma('busy_timeout = 1000')
            done(null, connection)
          } catch (error) {
            done(error, connection)
          }
        },
      },

      migrations: {
        /**
         * Sort migration files naturally by filename.
         */
        naturalSort: true,

        /**
         * Paths containing migration files.
         */
        paths: ['database/migrations'],
      },

      schemaGeneration: {
        /**
         * Enable schema generation from Lucid models.
         */
        enabled: true,

        /**
         * Custom schema rules file paths.
         */
        rulesPaths: ['./database/schema_rules.js'],
      },
    },
  },
})

export default dbConfig
