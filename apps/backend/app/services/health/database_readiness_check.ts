import { BaseCheck, Result } from '@adonisjs/core/health';
import type { HealthCheckResult } from '@adonisjs/core/types/health';
import { classifyLogError } from '#services/logging_safety';
import { assertSchemaIntegrity } from '#services/schema_integrity';
import logger from '@adonisjs/core/services/logger';
import db from '@adonisjs/lucid/services/db';

/** Checks connectivity and product schema together, without exposing failure details. */
export class DatabaseReadinessCheck extends BaseCheck {
  name = 'Database health check (sqlite)';

  async run(): Promise<HealthCheckResult> {
    try {
      await db.rawQuery('select 1');
      await assertSchemaIntegrity();
      return Result.ok('Database and schema are ready');
    } catch (error) {
      // The public readiness report must not expose database paths or schema details, so the
      // operator log carries the reason: drift messages name only tables and columns.
      const reason =
        error instanceof Error && error.message.startsWith('Database schema drift:')
          ? error.message
          : classifyLogError(error);
      logger.error({ reason }, 'Database readiness check failed');
      return Result.failed('Database readiness check failed');
    }
  }
}
