import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

const MAX_BATCH_BYTES = 5 * 1024 * 1024

export default class BodyLimitsMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    const declared = Number(request.header('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BATCH_BYTES)
      return response.status(413).send({ error: 'Request body is too large.' })
    if (Buffer.byteLength(JSON.stringify(request.body())) > MAX_BATCH_BYTES)
      return response.status(413).send({ error: 'Request body is too large.' })
    return next()
  }
}
