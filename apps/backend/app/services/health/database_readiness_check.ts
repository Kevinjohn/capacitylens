import { BaseCheck, Result } from '@adonisjs/core/health';
import type { HealthCheckResult } from '@adonisjs/core/types/health';
import { classifyLogError } from '#config/logger';
import { readSchemaIntegrity } from '#services/schema_integrity';
import logger from '@adonisjs/core/services/logger';
import db from '@adonisjs/lucid/services/db';

/**
 * Checks connectivity and the schema check boot recorded, without exposing failure details. An
 * empty database, where boot skips the check, is ready.
 */
export class DatabaseReadinessCheck extends BaseCheck {
  name = 'Database health check (sqlite)';

  async run(): Promise<HealthCheckResult> {
    try {
      await db.rawQuery('select 1');
      const schema = readSchemaIntegrity();
      if (schema.kind === 'drift') throw new Error(schema.message);
      return Result.ok('Database and schema are ready');
    } catch (error) {
      // The public readiness report must not expose database paths or schema details, so the
      // operator log carries the reason: drift messages name only migration files.
      const reason =
        error instanceof Error && error.message.startsWith('Database schema drift:')
          ? error.message
          : classifyLogError(error);
      logger.error({ reason }, 'Database readiness check failed');
      return Result.failed('Database readiness check failed');
    }
  }
}
