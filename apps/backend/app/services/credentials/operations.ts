import { createHash } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { PostCommitError } from 'adonisjs-account-kit/errors'
import { usersAdapter, PasswordIneligibleError } from '#services/account_kit/users_adapter'
import { assertPasswordAllowed } from '#services/password_screening'
import {
  assertFreshSession,
  resolveCurrentActor,
  SessionAuthorityError,
} from '#services/auth/session_authority'
import {
  assertAdminScope,
  commandExists,
  deliveryCode,
  makeKit,
  privateDiagnostic,
} from '#services/credentials/operation_factory'
import {
  CredentialInputError,
  CredentialUnavailableError,
} from '#services/credentials/credential_errors'
import {
  isAccountCommandId,
  isAccountIdempotencyKey,
} from '@capacitylens/shared/account/validation'

export {
  CredentialAuthorityError,
  CredentialConflictError,
  CredentialInputError,
  CredentialUnavailableError,
} from '#services/credentials/credential_errors'

/** Public reset request always acknowledges eligible and unknown addresses identically. */
export async function requestPublicReset(email: string, clientKey: string) {
  const { requestReset } = makeKit({ kind: 'public' })
  try {
    await requestReset({ email, clientKey })
  } catch (error) {
    if (error instanceof PasswordIneligibleError) return
    if (error instanceof PostCommitError) {
      privateDiagnostic(
        { code: error.code, causeCode: deliveryCode(error.cause) },
        'Recovery issuance committed with a follow-up failure'
      )
      return
    }
    throw error
  }
}

/** Redeems one recovery token after screening, then invalidates all indexed sessions. */
export async function resetPassword(token: string, newPassword: string) {
  await assertPasswordAllowed(newPassword)
  const { resetPassword: completeReset } = makeKit({ kind: 'reset' })
  await completeReset({ token, password: newPassword })
}

/** Changes the actor's own password, optionally retaining their initiating session. */
export async function changePassword(
  ctx: HttpContext,
  currentPassword: string,
  newPassword: string,
  revokeOtherSessions = true
) {
  const actor = await resolveCurrentActor(ctx)
  await assertPasswordAllowed(newPassword)
  const { changePassword: completeChange } = makeKit({
    kind: 'change',
    ctx,
    actorId: actor.userId,
    revokeOtherSessions,
  })
  await completeChange({ actorId: actor.userId, currentPassword, newPassword })
}

interface AdminResetInput {
  ctx: HttpContext
  targetUserId: string
  accountId: string
  commandId: string
  idempotencyKey: string
  signal?: AbortSignal
}

/** Issues an administrative copy-link with a transaction-current target and command claim. */
export async function requestAdministrativeReset(input: AdminResetInput) {
  if (!isAccountCommandId(input.commandId) || !isAccountIdempotencyKey(input.idempotencyKey))
    throw new CredentialInputError()
  const initialActor = await resolveCurrentActor(input.ctx)
  const commandOperation = `password-reset:actor:${initialActor.userId}`
  const aliases = [
    `command:${input.commandId}`,
    `idempotency:${commandOperation}\0${input.idempotencyKey}`,
  ].sort()
  return withCommandGates(
    aliases,
    () => issueAdministrativeReset(input, commandOperation, initialActor.userId),
    input.signal
  )
}

const commandGates = new Map<string, { tail: Promise<void>; waiting: number }>()

function awaitGate(gate: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return gate
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    gate.then(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, reject)
  })
}

async function withCommandGate<T>(
  commandId: string,
  run: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const existing = commandGates.get(commandId)
  if (!existing) {
    if (signal?.aborted) throw signal.reason
    if (commandGates.size >= 1024) throw new CredentialUnavailableError()
    let release!: () => void
    const tail = new Promise<void>((resolve) => {
      release = resolve
    })
    commandGates.set(commandId, { tail, waiting: 0 })
    try {
      return await run()
    } finally {
      commandGates.delete(commandId)
      release()
    }
  }
  if (existing.waiting >= 16) throw new CredentialUnavailableError()
  existing.waiting++
  try {
    await awaitGate(existing.tail, signal)
  } finally {
    existing.waiting--
  }
  return withCommandGate(commandId, run, signal)
}

function withCommandGates<T>(
  aliases: string[],
  run: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const [first, ...rest] = aliases
  return first ? withCommandGate(first, () => withCommandGates(rest, run, signal), signal) : run()
}

async function issueAdministrativeReset(
  input: AdminResetInput,
  commandOperation: string,
  initialActorId: string
) {
  const actor = await resolveCurrentActor(input.ctx)
  if (actor.userId !== initialActorId) throw new SessionAuthorityError('Session identity changed.')
  if (actor.userId !== input.targetUserId) assertFreshSession(actor)
  await db.transaction(async (trx) =>
    assertAdminScope(actor.userId, input.targetUserId, input.accountId, trx)
  )
  const payloadHash = createHash('sha256')
    .update(
      JSON.stringify({
        operation: commandOperation,
        actorId: actor.userId,
        targetId: input.targetUserId,
        accountId: input.accountId,
        commandId: input.commandId,
        idempotencyKey: input.idempotencyKey,
      })
    )
    .digest('hex')
  await commandExists(input.commandId, commandOperation, input.idempotencyKey)
  const target = await usersAdapter.findById(input.targetUserId)
  if (!target?.hasPassword) throw new PasswordIneligibleError()
  const instance = makeKit({
    kind: 'admin',
    ctx: input.ctx,
    actorId: actor.userId,
    targetId: input.targetUserId,
    accountId: input.accountId,
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    commandOperation,
    payloadHash,
  })
  try {
    await instance.requestReset({ email: target.email, clientKey: actor.userId })
  } catch (error) {
    if (!(error instanceof PostCommitError)) throw error
    // The command row is proof that issuance committed; return the captured bearer only to this call.
    if (!(await db.from('command_results').where('command_id', input.commandId).first()))
      throw error
  }
  instance.markCaptured()
  return instance.captured()
}
