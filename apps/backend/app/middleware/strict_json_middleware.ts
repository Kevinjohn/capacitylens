import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { TextDecoder } from 'node:util'
import { assertUnambiguousJson } from '@capacitylens/shared/data/strictJson'
export default class StrictJsonMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    if (
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) ||
      !request.is(['application/json', 'application/csp-report', 'application/reports+json'])
    )
      return next()
    const limit = request.url() === '/api/security/csp-report' ? 64 * 1024 : 5 * 1024 * 1024
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request.request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size <= limit) chunks.push(bytes)
    }
    if (size > limit) return response.status(413).send({ error: 'Request body is too large.' })
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
      if (source.length === 0 && request.is(['application/json']))
        return response.badRequest({
          error: "Body cannot be empty when content-type is set to 'application/json'.",
        })
      assertUnambiguousJson(source)
      request.updateBody(JSON.parse(source) as Record<string, unknown>)
    } catch {
      return response.status(400).send({
        error: request.is(['application/csp-report', 'application/reports+json'])
          ? 'Malformed CSP report.'
          : "Body is not valid JSON but content-type is set to 'application/json'.",
      })
    }
    return next()
  }
}
