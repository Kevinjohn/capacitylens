import app from '@adonisjs/core/services/app'
import { HealthChecks } from '@adonisjs/core/health'
import { DatabaseReadinessCheck } from '#services/health/database_readiness_check'
import { SchemaIntegrityService } from '#services/schema_integrity_service'

export const healthChecks = new HealthChecks().register([
  new DatabaseReadinessCheck(await app.container.make(SchemaIntegrityService)),
])
