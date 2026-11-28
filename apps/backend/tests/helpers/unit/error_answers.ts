import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import loggerConfig from '#config/logger'
import PlanningController from '#controllers/planning_controller'
import HttpExceptionHandler from '#exceptions/handler'

/** Runs `run` with `app.inProduction` set, where a 500 answers with its fixed sentence. */
export async function inProduction<T>(run: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(app, 'inProduction')
  Object.defineProperty(app, 'inProduction', { configurable: true, value: true })
  try {
    return await run()
  } finally {
    if (descriptor) Object.defineProperty(app, 'inProduction', descriptor)
    else Reflect.deleteProperty(app, 'inProduction')
  }
}

/** The `err` field as the logger writes it. */
export const serializeErr = (error: unknown) => loggerConfig.loggers.app.serializers!.err!(error)

/** A recording HTTP context whose route-parameter read throws `error`. */
export function context(error: unknown, routeName?: string) {
  const result = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> }
  const diagnostics: Array<{ level: string; fields: Record<string, unknown>; message: string }> = []
  const response = {
    header(name: string, value: string) {
      result.headers[name] = value
      return this
    },
    status(status: number) {
      result.status = status
      return this
    },
    internalServerError(body: unknown) {
      result.status = 500
      result.body = body
    },
    forbidden(body: unknown) {
      result.status = 403
      result.body = body
    },
    badRequest(body: unknown) {
      result.status = 400
      result.body = body
    },
    send(body: unknown) {
      result.body = body
    },
  }
  return {
    result,
    diagnostics,
    ctx: {
      response,
      logger: {
        log(level: string, fields: Record<string, unknown>, message: string) {
          diagnostics.push({ level, fields, message })
        },
      },
      request: {
        method: () => 'POST',
        id: () => undefined,
        accepts: () => 'json',
        qs: () => ({}),
        // The planning read's first step validates the request; that is where `error` is thrown.
        validateUsing() {
          throw error
        },
        params() {
          throw error
        },
      },
      route: { pattern: '/api/v1/companies/:companyId/resources', name: routeName },
    } as unknown as HttpContext,
  }
}

/** Runs the planning read on a planning route; what it throws is answered by the handler. */
export async function answerOnPlanning(error: unknown) {
  const planning = context(error, 'api.planning.show')
  try {
    const controller = await app.container.make(PlanningController)
    await controller.show(planning.ctx)
  } catch (thrown) {
    await new HttpExceptionHandler().handle(thrown, planning.ctx)
  }
  return planning.result
}

/** What the exception handler answers for `error`. */
export async function answered(error: unknown) {
  const { ctx, result } = context(error)
  await new HttpExceptionHandler().handle(error, ctx)
  return { status: result.status, body: result.body }
}

/** What the handler answers for the error a call throws. */
export async function answeredThrown(call: () => unknown) {
  try {
    await call()
  } catch (error) {
    return answered(error)
  }
  throw new Error('Expected a refusal.')
}

/**
 * The framework's answer to a route validator's failure, kept to the status and the first error's
 * message: the sentence the validator fixes.
 */
export async function routeValidationAnswer(call: () => unknown) {
  const { status, body } = await answeredThrown(call)
  const [first] = (body as { errors: Array<{ message: string }> }).errors
  return { status, body: { errors: [{ message: first?.message }] } }
}
