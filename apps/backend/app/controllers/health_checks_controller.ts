import type { HttpContext } from '@adonisjs/core/http';
import { healthChecks } from '#start/health';

export default class HealthChecksController {
  async handle({ response }: HttpContext) {
    const report = await healthChecks.run();
    return report.isHealthy ? response.ok(report) : response.serviceUnavailable(report);
  }
}
