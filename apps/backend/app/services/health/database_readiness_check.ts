import { BaseCheck, Result } from '@adonisjs/core/health'
import type { HealthCheckResult } from '@adonisjs/core/types/health'
import { assertSchemaIntegrity } from '#services/schema_integrity'
import db from '@adonisjs/lucid/services/db'

/** Checks connectivity and product schema together, without exposing failure details. */
export class DatabaseReadinessCheck extends BaseCheck {
  name = 'Database health check (sqlite)'

  async run(): Promise<HealthCheckResult> {
    try {
      await db.rawQuery('select 1')
      await assertSchemaIntegrity()
      return Result.ok('Database and schema are ready')
    } catch {
      // The public readiness report must not expose database paths or schema details.
      return Result.failed('Database readiness check failed')
    }
  }
}
