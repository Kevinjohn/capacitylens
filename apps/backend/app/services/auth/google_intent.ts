import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import { GoogleIdentityError } from './google_identity.js'

export type GoogleIntent = {
  kind: 'sign-in' | 'link' | 'join'
  successPath: string
  errorPath: string
  createdAt: number
  actorId?: string
  sessionId?: string
  joinIntentId?: string
}

const KEY = 'googleOAuthIntent'
const TTL_MS = 15 * 60_000

/** Confines browser callbacks to this product origin, excluding fragments and auth endpoints. */
export function callbackPath(value: unknown) {
  if (typeof value !== 'string')
    throw new GoogleIdentityError('Invalid callback URL.', 400, 'INVALID_CALLBACK_URL')
  let url: URL
  const origin = env.get('CAPACITYLENS_PUBLIC_URL') || env.get('APP_URL')
  try {
    url = new URL(value)
  } catch {
    throw new GoogleIdentityError('Invalid callback URL.', 400, 'INVALID_CALLBACK_URL')
  }
  // A leading `//` survives as a protocol-relative Location and would leave the product origin.
  if (
    url.origin !== origin ||
    url.hash ||
    url.pathname.startsWith('//') ||
    url.pathname.startsWith('/api/')
  )
    throw new GoogleIdentityError('Invalid callback URL.', 400, 'INVALID_CALLBACK_URL')
  return `${url.pathname}${url.search}`
}

export function readGoogleIntent(ctx: HttpContext): GoogleIntent {
  const value: unknown = ctx.session.get(KEY)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new GoogleIdentityError('Google sign-in expired.', 403, 'GOOGLE_INTENT_EXPIRED')
  const intent = value as Record<string, unknown>
  if (
    !['sign-in', 'link', 'join'].includes(String(intent.kind)) ||
    typeof intent.successPath !== 'string' ||
    typeof intent.errorPath !== 'string' ||
    typeof intent.createdAt !== 'number' ||
    !Number.isSafeInteger(intent.createdAt) ||
    intent.createdAt > Date.now() ||
    Date.now() - intent.createdAt >= TTL_MS
  )
    throw new GoogleIdentityError('Google sign-in expired.', 403, 'GOOGLE_INTENT_EXPIRED')
  return intent as GoogleIntent
}

/** Replaces the one pending browser OAuth journey; Ally owns its separate CSRF state cookie. */
export function storeGoogleIntent(ctx: HttpContext, intent: GoogleIntent) {
  ctx.session.put(KEY, intent)
}

export function clearGoogleIntent(ctx: HttpContext) {
  ctx.session.forget(KEY)
}

export function googleErrorPath(path: string, code: string) {
  const url = new URL(path, env.get('CAPACITYLENS_PUBLIC_URL') || env.get('APP_URL'))
  url.searchParams.set('externalSignInError', '1')
  url.searchParams.set('error', code)
  return `${url.pathname}${url.search}`
}
