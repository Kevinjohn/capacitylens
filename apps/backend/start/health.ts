import { HealthChecks } from '@adonisjs/core/health'
import { DatabaseReadinessCheck } from '#services/health/database_readiness_check'

export const healthChecks = new HealthChecks().register([new DatabaseReadinessCheck()])
