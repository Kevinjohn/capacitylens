import { createHash } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import limiter from '@adonisjs/limiter/services/main'
import app from '@adonisjs/core/services/app'
import env from '#start/env'

const maxLimit = 1_000_000

export function configuredApiLimit(): number {
  const raw = env.get('CAPACITYLENS_RATE_LIMIT')
  if (raw === undefined || raw === '') return app.inProduction ? 300 : 0
  if (!/^\d+$/.test(raw)) return 0
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 && value <= maxLimit ? value : 0
}

/** The client address follows the HTTP server's proxy trust in `config/app.ts`. */
export function requestClientKey(ctx: HttpContext): string {
  return createHash('sha256').update(ctx.request.ip()).digest('hex')
}

export async function consumeFailedSignInBudget(ctx: HttpContext): Promise<boolean> {
  const budget = limiter.use({ requests: 3, duration: '10 seconds' })
  try {
    await budget.consume(`sign-in:${requestClientKey(ctx)}`)
    return true
  } catch (error) {
    if ((error as { status?: number }).status === 429) return false
    throw error
  }
}

export async function resetFailedSignInBudget(ctx: HttpContext): Promise<void> {
  const budget = limiter.use({ requests: 3, duration: '10 seconds' })
  await budget.delete(`sign-in:${requestClientKey(ctx)}`)
}
