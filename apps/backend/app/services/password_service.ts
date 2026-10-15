import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { currentPasswordAbortSignal, PasswordWorkQueue } from './password_work_queue.js'

export { runWithPasswordAbortSignal } from './password_work_queue.js'

const SCRYPT_N = 2 ** 17
const SCRYPT_R = 8
const SCRYPT_P = 1
const SALT_BYTES = 16
const KEY_BYTES = 64
const MAX_SCRYPT_MEMORY = 256 * 1024 * 1024
const MAX_QUEUE_WAIT_MS = 5_000
const MAX_ENCODED_HASH_LENGTH = 256

const scryptQueue = new PasswordWorkQueue(2, 16, MAX_QUEUE_WAIT_MS)

export class PasswordProcessingUnavailableError extends Error {
  readonly code = 'PASSWORD_PROCESSING_UNAVAILABLE'

  constructor(cause?: unknown) {
    super('Password processing is temporarily unavailable. Try again later.', { cause })
    this.name = 'PasswordProcessingUnavailableError'
  }
}

interface ScryptInput {
  password: string
  salt: Buffer
  n: number
  r: number
  p: number
}

function derive(input: ScryptInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      input.password,
      input.salt,
      KEY_BYTES,
      { N: input.n, r: input.r, p: input.p, maxmem: MAX_SCRYPT_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key))
    )
  })
}

async function processPassword(input: ScryptInput): Promise<Buffer> {
  try {
    return await scryptQueue.run(() => derive(input), currentPasswordAbortSignal())
  } catch (error) {
    throw new PasswordProcessingUnavailableError(error)
  }
}

/** Hashes exact UTF-8 password bytes with the product's bounded scrypt profile. */
export async function hashPassword(password: string): Promise<string> {
  try {
    const salt = randomBytes(SALT_BYTES)
    const key = await processPassword({
      password,
      salt,
      n: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    })
    return `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`
  } catch (error) {
    if (error instanceof PasswordProcessingUnavailableError) throw error
    throw new PasswordProcessingUnavailableError(error)
  }
}

function parseStoredHash(encodedHash: string): (ScryptInput & { expected: Buffer }) | null {
  if (encodedHash.length > MAX_ENCODED_HASH_LENGTH) return null
  const fields = encodedHash.split('$')
  if (fields.length !== 4 || fields[0] !== 'scrypt') return null
  const params = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(fields[1] ?? '')
  const saltText = fields[2]
  const expectedText = fields[3]
  if (!params || !saltText || !expectedText) return null

  const n = Number(params[1])
  const r = Number(params[2])
  const p = Number(params[3])
  if (
    !Number.isSafeInteger(n) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    n < 2 ||
    (n & (n - 1)) !== 0 ||
    n > SCRYPT_N ||
    r < 1 ||
    r > SCRYPT_R ||
    p < 1 ||
    p > SCRYPT_P ||
    128 * n * r + 128 * r * p > MAX_SCRYPT_MEMORY
  ) {
    return null
  }

  if (!/^[A-Za-z0-9_-]+$/.test(saltText) || !/^[A-Za-z0-9_-]+$/.test(expectedText)) return null
  const salt = Buffer.from(saltText, 'base64url')
  const expected = Buffer.from(expectedText, 'base64url')
  if (
    salt.length !== SALT_BYTES ||
    expected.length !== KEY_BYTES ||
    salt.toString('base64url') !== saltText ||
    expected.toString('base64url') !== expectedText
  ) {
    return null
  }
  return { password: '', salt, n, r, p, expected }
}

/** A well-formed hash that no password matches; verifying it costs the same as a real one. */
export const UNMATCHABLE_PASSWORD_HASH = `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${Buffer.alloc(SALT_BYTES).toString('base64url')}$${Buffer.alloc(KEY_BYTES).toString('base64url')}`

/** Verifies a stored product scrypt hash, returning false only for malformed or non-matching credentials. */
export async function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  const parsed = parseStoredHash(encodedHash)
  if (!parsed) return false
  const { expected, ...input } = parsed
  input.password = password
  const actual = await processPassword(input)
  return timingSafeEqual(actual, expected)
}
