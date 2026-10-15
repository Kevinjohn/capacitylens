import { createHash } from 'node:crypto'
import env from '#start/env'
import { currentPasswordAbortSignal, PasswordWorkQueue } from './password_work_queue.js'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_QUEUE_WAIT_MS = 5_000
const hibpQueue = new PasswordWorkQueue(8, 32, MAX_QUEUE_WAIT_MS)
const contextWords = [
  'capacitylens',
  'capacity-lens',
  'capacity lens',
  'administrator',
  'adminadmin',
]

export class PasswordPolicyError extends Error {
  constructor(
    message: string,
    readonly code: 'PASSWORD_CONTEXT_REJECTED' | 'PASSWORD_COMPROMISED'
  ) {
    super(message)
    this.name = 'PasswordPolicyError'
  }
}

export class PasswordScreeningUnavailableError extends Error {
  readonly code = 'PASSWORD_CHECK_UNAVAILABLE'

  constructor(cause?: unknown) {
    super('The breached-password check is temporarily unavailable; try again later.', { cause })
    this.name = 'PasswordScreeningUnavailableError'
  }
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new RangeError('Breached-password response exceeded the configured limit.')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let byteCount = 0
  let text = ''
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    byteCount += chunk.value.byteLength
    if (byteCount > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new RangeError('Breached-password response exceeded the configured limit.')
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
}

async function breachedPasswordRange(prefix: string): Promise<string> {
  const requestSignal = currentPasswordAbortSignal()
  try {
    return await hibpQueue.run(async () => {
      const timeout = AbortSignal.timeout(5_000)
      const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: {
          'Add-Padding': 'true',
          'User-Agent': 'CapacityLens password checker',
        },
        signal,
        redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new PasswordScreeningUnavailableError()
      }
      try {
        return await readBoundedResponseText(response)
      } catch (cause) {
        throw new PasswordScreeningUnavailableError(cause)
      }
    }, requestSignal)
  } catch (cause) {
    if (cause instanceof PasswordScreeningUnavailableError) throw cause
    throw new PasswordScreeningUnavailableError(cause)
  }
}

function assertNoContextSpecificPassword(password: string): void {
  const lowered = password.toLocaleLowerCase('en-GB')
  if (contextWords.some((word) => lowered.includes(word.toLocaleLowerCase('en-GB')))) {
    throw new PasswordPolicyError(
      'Choose a password that does not contain the product name or an administrative role.',
      'PASSWORD_CONTEXT_REJECTED'
    )
  }
}

async function assertPasswordNotBreached(password: string): Promise<void> {
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
  const responseText = await breachedPasswordRange(digest.slice(0, 5))
  const suffix = digest.slice(5)
  const lines = responseText.replace(/\r?\n$/, '').split(/\r?\n/)
  let found = false
  for (const line of lines) {
    const record = /^([A-Fa-f0-9]{35}):([0-9]+)$/.exec(line)
    if (!record) {
      throw new PasswordScreeningUnavailableError()
    }
    if (record[1]?.toUpperCase() === suffix && /[1-9]/.test(record[2] ?? '')) found = true
  }
  if (found) {
    throw new PasswordPolicyError(
      'This password appears in a known breach. Choose a different password.',
      'PASSWORD_COMPROMISED'
    )
  }
}

/** Applies product password checks, including breach screening unless the validated env explicitly disables it. */
export async function assertPasswordAllowed(password: string): Promise<void> {
  assertNoContextSpecificPassword(password)
  if (env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK') === false) return
  try {
    await assertPasswordNotBreached(password)
  } catch (error) {
    if (
      error instanceof PasswordPolicyError ||
      error instanceof PasswordScreeningUnavailableError
    ) {
      throw error
    }
    throw new PasswordScreeningUnavailableError(error)
  }
}
