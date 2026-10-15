import { createHash, randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import encryption from '@adonisjs/core/services/encryption'
import limiter from '@adonisjs/limiter/services/main'
import mail from '@adonisjs/mail/services/main'
import logger from '@adonisjs/core/services/logger'
import { AccountKit, defineConfig } from 'adonisjs-account-kit'
import type { Trx } from 'adonisjs-account-kit/types'
import env from '#start/env'
import { usersAdapter, PasswordIneligibleError } from '#services/account_kit/users_adapter'
import {
  assertFreshSession,
  destroyNativeSessions,
  invalidateUserSessions,
  resolveCurrentActor,
  SessionAuthorityError,
} from '#services/auth/session_authority'
import { assertMayAdministerTarget, IdentityAuthorityError } from '#services/auth/authorization'
import { writeAudit } from '#services/audit'
import { clearMemberSignIn } from '#services/membership/sign_in_tracking'
import { canAdministerIdentity } from '@capacitylens/shared/account/policy'
import type { Role } from '@capacitylens/shared/account/types'
import {
  CredentialConflictError,
  CredentialUnavailableError,
  CredentialAuthorityError,
} from '#services/credentials/credential_errors'

type Operation =
  | { kind: 'public' }
  | { kind: 'reset' }
  | { kind: 'change'; ctx: HttpContext; actorId: string; revokeOtherSessions: boolean }
  | {
      kind: 'admin'
      ctx: HttpContext
      actorId: string
      targetId: string
      accountId: string
      commandId: string
      idempotencyKey: string
      commandOperation: string
      payloadHash: string
    }

let backgroundDeliveries = 0
const MAX_BACKGROUND_DELIVERIES = 16

/** Reduces a follow-up failure to a safe diagnostic code. */
export function deliveryCode(cause: unknown) {
  const value = cause as { code?: unknown }
  return typeof value?.code === 'string' && /^[A-Z_]{2,64}$/.test(value.code)
    ? value.code
    : 'MAIL_TRANSPORT_ERROR'
}

/** Keeps diagnostic failure from changing a committed credential outcome. */
export function privateDiagnostic(fields: Record<string, string | number>, message: string) {
  try {
    logger.error(fields, message)
  } catch {
    // A broken logger must not turn a committed issuance or detached mail failure into a rejection.
    console.error('Credential diagnostic logger failed')
  }
}

async function sendNotice(email: string, subject: string, text: string) {
  if (!env.get('CAPACITYLENS_MAIL_HOST')) return
  await mail.send((message) => {
    message.to(email).subject(subject).text(text)
  })
}

function secret() {
  // A stable application secret is mandatory for private limiter keys.
  return createHash('sha256')
    .update(env.get('CAPACITYLENS_SECRET') || env.get('APP_KEY').release())
    .digest('hex')
}

function recoveryLink(token: string) {
  const origin = env.get('CAPACITYLENS_PUBLIC_URL') || env.get('APP_URL')
  return new URL(`/reset-password/${encodeURIComponent(token)}`, origin).href
}

async function auditCredentials(trx: Trx, userId: string, actorId: string, action: string) {
  const memberships = await trx.from('memberships').where('user_id', userId).select('account_id')
  for (const membership of memberships) {
    await writeAudit(trx, {
      accountId: String(membership.account_id),
      actorId,
      action,
      entity: 'user',
      entityId: userId,
      fields: ['password'],
    })
  }
}

/** Refuses either identity alias before consuming an issuance allowance. */
export async function commandExists(
  commandId: string,
  commandOperation: string,
  idempotencyKey: string,
  connection: typeof db | Trx = db
) {
  const existing = await connection
    .from('command_results')
    .where((query) => {
      query
        .where('command_id', commandId)
        .orWhere({ operation: commandOperation, idempotency_key: idempotencyKey })
    })
    .first()
  if (existing) throw new CredentialConflictError()
}

/** Rechecks account and identity-wide authority on the supplied transaction. */
export async function assertAdminScope(
  actorId: string,
  targetId: string,
  accountId: string,
  trx: Trx
) {
  const [actor, target] = await Promise.all([
    trx
      .from('memberships')
      .where({ account_id: accountId, user_id: actorId, status: 'active' })
      .first(),
    trx.from('memberships').where({ account_id: accountId, user_id: targetId }).first(),
  ])
  if (!actor || !target || !canAdministerIdentity(actor.role as Role, target.role as Role))
    throw new CredentialAuthorityError()
  try {
    await assertMayAdministerTarget(actorId, targetId, trx)
  } catch (error) {
    if (error instanceof IdentityAuthorityError) throw new CredentialAuthorityError()
    throw error
  }
}

/** Builds isolated account-kit callbacks and captures for one credential operation. */
export function makeKit(operation: Operation) {
  let issuedToken: string | null = null
  let expiresAt: string | null = null
  let invalidatedIds: string[] = []
  let captureReady = false
  const config = defineConfig({
    users: usersAdapter,
    enabled: ['recovery', 'credentials'],
    usersTable: 'users',
    limiterSecret: secret(),
    limiterNamespace: 'capacitylens:account-kit:v1',
    ttl: { recovery: '24h' },
    throttle: { requests: 5, duration: '15m' },
    minRequestMs: 300,
    urls: {
      recovery(token) {
        if (operation.kind === 'admin') issuedToken = token
        return recoveryLink(token)
      },
      emailChange() {
        throw new Error('Email change is unavailable.')
      },
    },
    notify: {
      async recovery(user, url) {
        if (operation.kind === 'admin') return // Administrative issuance is capture-only.
        if (operation.kind !== 'public' || !user.hasPassword) return
        // Start delivery promptly; the public response must not wait on SMTP latency.
        if (backgroundDeliveries >= MAX_BACKGROUND_DELIVERIES) {
          privateDiagnostic(
            { code: 'MAIL_DELIVERY_QUEUE_FULL' },
            'Password reset email delivery queue is full'
          )
          return
        }
        backgroundDeliveries++
        void mail
          .send((message) => {
            message
              .to(user.email)
              .subject('Reset your password')
              .text(
                `Open this link to reset your password: ${url}\n\nThis link expires in 24 hours.`
              )
          })
          .catch((cause) => {
            privateDiagnostic({ code: deliveryCode(cause) }, 'Password reset email delivery failed')
          })
          .finally(() => {
            backgroundDeliveries--
          })
      },
      async passwordReset(user) {
        await sendNotice(
          user.email,
          'Your password was reset',
          'Your CapacityLens password was reset. If this was not you, contact your company administrator.'
        )
      },
      async passwordChanged(user) {
        await sendNotice(
          user.email,
          'Your password was changed',
          'Your CapacityLens password was changed. If this was not you, contact your company administrator.'
        )
      },
      async emailChangeConfirm() {
        throw new Error('Email change is unavailable.')
      },
      async emailChanged() {
        throw new Error('Email change is unavailable.')
      },
    },
    async onRecoveryIssuedTransaction(user, trx) {
      if (operation.kind === 'public' && !user.hasPassword) throw new PasswordIneligibleError()
      if (operation.kind !== 'admin') return
      invalidatedIds = []
      issuedToken = null
      expiresAt = null
      const actor = await resolveCurrentActor(operation.ctx, trx)
      if (actor.userId !== operation.actorId)
        throw new SessionAuthorityError('Session identity changed.')
      if (actor.userId !== operation.targetId) assertFreshSession(actor)
      await assertAdminScope(actor.userId, operation.targetId, operation.accountId, trx)
      if (String(user.id) !== operation.targetId || !user.hasPassword)
        throw new PasswordIneligibleError()
      const target = await trx
        .from('users')
        .where('id', operation.targetId)
        .select('email', 'password_hash')
        .first()
      if (!target?.password_hash || target.email !== user.email) throw new PasswordIneligibleError()
      await commandExists(
        operation.commandId,
        operation.commandOperation,
        operation.idempotencyKey,
        trx
      )
      const row = await trx
        .from('account_recovery_tokens')
        .where('user_id', operation.targetId)
        .select('expires_at')
        .first()
      if (!row) throw new CredentialUnavailableError()
      expiresAt = String(row.expires_at)
      await writeAudit(trx, {
        accountId: operation.accountId,
        actorId: actor.userId,
        action: 'member.password_reset_requested',
        entity: 'user',
        entityId: operation.targetId,
        fields: ['password'],
      })
      const now = new Date().toISOString()
      await trx.table('command_results').insert({
        id: randomUUID(),
        account_id: operation.accountId,
        command_id: operation.commandId,
        operation: operation.commandOperation,
        idempotency_key: operation.idempotencyKey,
        payload_hash: operation.payloadHash,
        result: JSON.stringify({ status: 'issued' }),
        created_at: now,
        updated_at: now,
      })
      await clearMemberSignIn(operation.targetId, trx)
    },
    async onCredentialsChangedTransaction(user, _context, trx) {
      invalidatedIds = []
      const userId = String(user.id)
      if (operation.kind === 'change') {
        const actor = await resolveCurrentActor(operation.ctx, trx)
        if (actor.userId !== operation.actorId || actor.userId !== userId)
          throw new SessionAuthorityError('Session identity changed.')
        if (operation.revokeOtherSessions)
          invalidatedIds = await invalidateUserSessions(
            { userId, preserveSessionId: actor.sessionId },
            trx
          )
        await auditCredentials(trx, userId, actor.userId, 'user.password_changed')
      } else if (operation.kind === 'reset') {
        invalidatedIds = await invalidateUserSessions({ userId }, trx)
        await auditCredentials(trx, userId, userId, 'user.password_reset')
      }
    },
    async onLifecycleEvent(event) {
      if (event.type !== 'password.reset' && event.type !== 'password.changed') return
      const ids = invalidatedIds
      invalidatedIds = []
      const [logged, cleaned] = await Promise.allSettled([
        Promise.resolve().then(() =>
          logger.info(
            { event: event.type, userId: String(event.userId), operationId: event.operationId },
            'Credential lifecycle committed'
          )
        ),
        destroyNativeSessions(ids),
      ])
      if (cleaned.status === 'rejected')
        privateDiagnostic(
          { code: deliveryCode(cleaned.reason), count: ids.length },
          'Committed credential cleanup failed'
        )
      if (logged.status === 'rejected' || cleaned.status === 'rejected')
        throw new CredentialUnavailableError()
    },
  })
  return {
    kit: new AccountKit({ config, db, encryption: encryption.use(), limiter }),
    captured() {
      if (operation.kind !== 'admin' || !issuedToken || !expiresAt || !captureReady)
        throw new CredentialUnavailableError()
      return { token: issuedToken, expiresAt }
    },
    markCaptured() {
      captureReady = true
    },
  }
}
