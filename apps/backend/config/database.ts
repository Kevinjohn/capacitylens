import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'
import env from '#start/env'

const dbConfig = defineConfig({
  connection: 'sqlite',

  connections: {
    sqlite: {
      client: 'better-sqlite3',

      connection: {
        filename: env.get('CAPACITYLENS_DB') ?? app.tmpPath('db.sqlite3'),
      },

      // Knex requires this for SQLite defaults.
      useNullAsDefault: true,
      pool: {
        min: 1,
        max: 1,
        acquireTimeoutMillis: 5000,
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
        naturalSort: true,
        // Production never rolls back (departure 21).
        disableRollbacksInProduction: true,
        paths: ['database/migrations'],
      },

      schemaGeneration: {
        enabled: true,
        rulesPaths: ['./database/schema_rules.js'],
      },
    },
  },
})

export default dbConfig
