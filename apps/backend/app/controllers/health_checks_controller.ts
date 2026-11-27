import type { HttpContext } from '@adonisjs/core/http'
import { healthChecks } from '#start/health'

/** Probes answer unwrapped: monitors read `ok` and the health report at the top level. */
export default class HealthChecksController {
  live({ serialize }: HttpContext) {
    return serialize.withoutWrapping({ ok: true })
  }

  async ready({ response, serialize }: HttpContext) {
    const report = await healthChecks.run()
    const body = await serialize.withoutWrapping(report)
    return report.isHealthy ? response.ok(body) : response.serviceUnavailable(body)
  }
}
