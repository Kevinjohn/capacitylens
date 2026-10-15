import { reportPrivateFailure } from '#services/logging_safety'
import type { HttpContext } from '@adonisjs/core/http'
import { withTransaction } from '#services/with_transaction'
import { googleEnabled, availableProviders } from '#services/auth/mode'
import {
  assertFreshSession,
  resolveCurrentActor,
  SessionAuthorityError,
} from '#services/auth/session_authority'
import {
  GOOGLE_ISSUER,
  GoogleIdentityError,
  verifiedGoogleProfile,
  googleSignInUser,
  linkGoogleIdentity,
  createGoogleSession,
  tagGoogleSession,
} from '#services/auth/google_identity'
import {
  callbackPath,
  clearGoogleIntent,
  googleErrorPath,
  readGoogleIntent,
  storeGoogleIntent,
  type GoogleIntent,
} from '#services/auth/google_intent'
import {
  parseGoogleJoinStart,
  startGoogleJoin,
  assertGoogleJoinCallback,
  approveGoogleJoin,
  googleJoinStatus,
  cancelGoogleJoin,
  completeGoogleJoin,
} from '#services/admission/google_joining'
import { hasCurrentEmailProof } from '#services/admission/joining_policy'
import { renderAdmissionFailure } from '#services/admission/http'
import { AdmissionError } from '#services/admission/errors'

function requireGoogle() {
  if (!googleEnabled())
    throw new GoogleIdentityError('Google sign-in is unavailable.', 404, 'PROVIDER_UNAVAILABLE')
}

function input(value: unknown, allowed: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new GoogleIdentityError('Invalid Google request.', 400, 'INVALID_INPUT')
  return value as Record<string, unknown>
}

function provider(value: unknown) {
  if (value !== 'google')
    throw new GoogleIdentityError('Provider is unavailable.', 404, 'PROVIDER_UNAVAILABLE')
}

function reply(ctx: HttpContext, error: unknown) {
  if (error instanceof GoogleIdentityError)
    return ctx.response.status(error.status).send({ error: error.message, code: error.code })
  return renderAdmissionFailure(ctx, error)
}

function marker(path: string, key: string, value: string) {
  const url = new URL(path, 'https://capacitylens.invalid')
  url.searchParams.set(key, value)
  return `${url.pathname}${url.search}`
}

function redirectTo(ctx: HttpContext, path: string) {
  return ctx.response.redirect().withQs(false).toPath(path)
}

/** A browser journey uses Ally's state cookie and one separate, short-lived product intent. */
async function begin(ctx: HttpContext, intent: GoogleIntent) {
  storeGoogleIntent(ctx, intent)
  await ctx.ally.use('google').redirect()
  const url = ctx.response.getHeader('location')
  if (typeof url !== 'string')
    throw new GoogleIdentityError('Google sign-in is unavailable.', 503, 'PROVIDER_UNAVAILABLE')
  ctx.response.removeHeader('location')
  return url
}

/** Starts and completes named Google identity and company-join browser journeys. */
export default class GoogleController {
  async providerStart(ctx: HttpContext) {
    try {
      requireGoogle()
      const body = input(ctx.request.body(), ['provider', 'callbackURL', 'errorCallbackURL'])
      provider(body.provider)
      const successPath = callbackPath(body.callbackURL)
      const errorPath = callbackPath(body.errorCallbackURL)
      let actor: Awaited<ReturnType<typeof resolveCurrentActor>> | null = null
      if (ctx.session.get('authenticatedAt') !== undefined) {
        try {
          actor = await resolveCurrentActor(ctx)
        } catch (error) {
          if (
            !(error instanceof SessionAuthorityError) &&
            (error as { status?: number }).status !== 401
          )
            throw error
        }
      }
      const url = await begin(ctx, {
        kind: 'sign-in',
        successPath,
        errorPath,
        createdAt: Date.now(),
        actorId: actor?.userId,
        sessionId: actor?.sessionId,
      })
      return ctx.response.ok({ url })
    } catch (error) {
      return reply(ctx, error)
    }
  }

  async linkStart(ctx: HttpContext) {
    try {
      requireGoogle()
      const body = input(ctx.request.body(), ['providerId', 'callbackURL', 'errorCallbackURL'])
      provider(body.providerId)
      const successPath = callbackPath(body.callbackURL)
      const errorPath = callbackPath(body.errorCallbackURL)
      const actor = await resolveCurrentActor(ctx)
      assertFreshSession(actor)
      const url = await begin(ctx, {
        kind: 'link',
        successPath,
        errorPath,
        createdAt: Date.now(),
        actorId: actor.userId,
        sessionId: actor.sessionId,
      })
      return ctx.response.ok({ url })
    } catch (error) {
      return reply(ctx, error)
    }
  }

  async providerInfo(ctx: HttpContext) {
    try {
      requireGoogle()
      const actor = await resolveCurrentActor(ctx)
      const status = await withTransaction(async (trx) => {
        const identity = await trx
          .from('provider_identities')
          .where({ user_id: actor.userId, provider: 'google', issuer: GOOGLE_ISSUER })
          .first()
        return {
          connected: Boolean(identity),
          verified: Boolean(
            identity &&
            identity.email === actor.user.email &&
            (await hasCurrentEmailProof(trx, actor.userId, actor.user.email))
          ),
        }
      })
      return ctx.response.ok({ provider: availableProviders()[0], ...status })
    } catch (error) {
      return reply(ctx, error)
    }
  }

  async joinStart(ctx: HttpContext) {
    try {
      requireGoogle()
      const body = parseGoogleJoinStart(ctx.request.body())
      const successPath = `/join/${encodeURIComponent(ctx.params.accountId)}`
      const url = await begin(ctx, {
        kind: 'join',
        successPath,
        errorPath: successPath,
        createdAt: Date.now(),
      })
      const state = new URL(url).searchParams.get('state')
      if (!state)
        throw new GoogleIdentityError('Google state is unavailable.', 503, 'PROVIDER_UNAVAILABLE')
      const result = await withTransaction((trx) =>
        startGoogleJoin(trx, ctx, ctx.params.accountId, body, state)
      )
      return ctx.response.ok({ ...result, url })
    } catch (error) {
      return reply(ctx, error)
    }
  }

  async callback(ctx: HttpContext) {
    let intent: GoogleIntent
    try {
      intent = readGoogleIntent(ctx)
    } catch {
      return redirectTo(ctx, googleErrorPath('/', 'provider_expired'))
    }
    const driver = ctx.ally.use('google')
    try {
      requireGoogle()
      if (driver.stateMisMatch())
        throw new GoogleIdentityError('Google state did not match.', 403, 'GOOGLE_STATE_MISMATCH')
      if (driver.hasError())
        throw new GoogleIdentityError('Google sign-in was declined.', 403, 'GOOGLE_PROVIDER_DENIED')
      const state = ctx.request.input('state')
      if (typeof state !== 'string' || !state)
        throw new GoogleIdentityError('Google state is missing.', 403, 'GOOGLE_STATE_MISMATCH')
      const profile = verifiedGoogleProfile(await driver.user())
      if (intent.actorId) await ctx.auth.use('web').authenticate()
      if (intent.kind === 'link') {
        await withTransaction((trx) =>
          linkGoogleIdentity(ctx, profile, intent.actorId!, intent.sessionId!, trx)
        )
        clearGoogleIntent(ctx)
        return redirectTo(ctx, marker(intent.successPath, 'capacitylensSsoLinked', 'google'))
      }
      const result = await withTransaction(async (trx) => {
        const join =
          intent.kind === 'join' ? await assertGoogleJoinCallback(trx, ctx, state, profile) : null
        if (intent.actorId && intent.kind === 'sign-in') {
          const actor = await resolveCurrentActor(ctx, trx)
          if (actor.userId !== intent.actorId || actor.sessionId !== intent.sessionId)
            throw new GoogleIdentityError(
              'Google reauthentication session changed.',
              403,
              'GOOGLE_REAUTH_DENIED'
            )
          const binding = await trx
            .from('provider_identities')
            .where({
              provider: 'google',
              issuer: GOOGLE_ISSUER,
              subject: profile.subject,
              user_id: actor.userId,
            })
            .first()
          if (!binding)
            throw new GoogleIdentityError(
              'Google reauthentication identity changed.',
              403,
              'GOOGLE_REAUTH_DENIED'
            )
        }
        const identity = await googleSignInUser(
          trx,
          profile,
          join?.invitation_id ? String(join.invitation_id) : undefined
        )
        const sessionId = await createGoogleSession(ctx, identity.user, profile.subject, trx)
        if (join) await approveGoogleJoin(trx, String(join.id), identity.userId)
        return { sessionId, userId: identity.userId }
      })
      await tagGoogleSession(ctx, result.sessionId, result.userId)
      clearGoogleIntent(ctx)
      return redirectTo(ctx, intent.successPath)
    } catch (error) {
      clearGoogleIntent(ctx)
      if (
        !(error instanceof GoogleIdentityError) &&
        !(error instanceof AdmissionError) &&
        !(error instanceof SessionAuthorityError)
      )
        reportPrivateFailure(
          ctx,
          { event: 'auth.google.callback_failed', errorType: 'provider_unavailable' },
          'Google callback failed'
        )
      const code =
        error instanceof GoogleIdentityError ||
        error instanceof AdmissionError ||
        error instanceof SessionAuthorityError
          ? error.code.toLowerCase()
          : 'provider_unavailable'
      const path =
        intent.kind === 'link'
          ? marker(intent.errorPath, 'capacitylensSsoLinkFailed', code)
          : googleErrorPath(intent.errorPath, code)
      return redirectTo(ctx, path)
    }
  }

  async joinStatus(ctx: HttpContext) {
    try {
      return ctx.response.ok(await withTransaction((trx) => googleJoinStatus(ctx, trx)))
    } catch (error) {
      return reply(ctx, error)
    }
  }

  async joinCancel(ctx: HttpContext) {
    try {
      await withTransaction((trx) => cancelGoogleJoin(ctx, trx))
      return ctx.response.ok({ ok: true })
    } catch (error) {
      return reply(ctx, error)
    }
  }

  async joinComplete(ctx: HttpContext) {
    try {
      const body = input(ctx.request.body() || {}, ['invitationToken'])
      if (body.invitationToken !== undefined && typeof body.invitationToken !== 'string')
        throw new GoogleIdentityError('Invalid invitation token.', 400, 'INVALID_INPUT')
      const result = await withTransaction((trx) =>
        completeGoogleJoin(ctx, body.invitationToken as string | undefined, trx)
      )
      return ctx.response.ok(result)
    } catch (error) {
      return reply(ctx, error)
    }
  }
}
