import type { HttpContext } from '@adonisjs/core/http';
import { healthChecks } from '#start/health';

export default class HealthChecksController {
  live() {
    return { ok: true };
  }

  async ready({ response }: HttpContext) {
    try {
      const report = await healthChecks.run();
      return report.isHealthy ? response.ok(report) : response.serviceUnavailable(report);
    } catch {
      return response.serviceUnavailable({ isHealthy: false, status: 'error', checks: [] });
    }
  }
}
