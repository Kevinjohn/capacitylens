import type { HttpContext } from '@adonisjs/core/http';
import { healthChecks } from '#start/health';

export default class HealthChecksController {
  live() {
    return { ok: true };
  }

  async ready({ response }: HttpContext) {
    const report = await healthChecks.run();
    return report.isHealthy ? response.ok(report) : response.serviceUnavailable(report);
  }
}
