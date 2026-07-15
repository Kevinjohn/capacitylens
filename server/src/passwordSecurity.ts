import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { BoundedWorkQueue } from './workQueue'

// OWASP Password Storage Cheat Sheet minimum scrypt profile: N=2^17, r=8, p=1.
// The format is versioned so parameters can be raised and legacy Better Auth hashes can be
// verified during a rolling upgrade without silently weakening newly-created credentials.
export const SCRYPT_N = 2 ** 17
export const SCRYPT_R = 8
export const SCRYPT_P = 1
const KEY_BYTES = 64
const SALT_BYTES = 16
export const MAX_HIBP_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_CONCURRENT_HIBP = 8
export const MAX_QUEUED_HIBP = 32
export const MAX_CONCURRENT_SCRYPT = 2
export const MAX_QUEUED_SCRYPT = 16
const hibpQueue = new BoundedWorkQueue(
  MAX_CONCURRENT_HIBP,
  MAX_QUEUED_HIBP,
  'Breached-password checking is temporarily at capacity.',
)
const scryptQueue = new BoundedWorkQueue(
  MAX_CONCURRENT_SCRYPT,
  MAX_QUEUED_SCRYPT,
  'Password processing is temporarily at capacity.',
)

export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(input: { hash: string; password: string }): Promise<boolean>
}

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return scryptQueue.run(
    () => new Promise((resolve, reject) => {
      scryptCallback(password, salt, KEY_BYTES, { N: n, r, p, maxmem: 256 * 1024 * 1024 }, (error, key) => {
        if (error) reject(error)
        else resolve(key)
      })
    }),
  )
}

/** Strong new hashes plus read-only compatibility with Better Auth's former `salt:key` format. */
export function scryptPasswordHasher(n = SCRYPT_N): PasswordHasher {
  if (!Number.isSafeInteger(n) || n < 2 || (n & (n - 1)) !== 0) {
    throw new RangeError('scrypt N must be a power of two greater than one.')
  }
  return {
    async hash(password: string): Promise<string> {
      const salt = randomBytes(SALT_BYTES)
      const key = await derive(password, salt, n, SCRYPT_R, SCRYPT_P)
      return `scrypt-v1$${n}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`
    },
    async verify({ hash, password }): Promise<boolean> {
      const fields = hash.split('$')
      if (fields.length === 6 && fields[0] === 'scrypt-v1') {
        const parsedN = Number(fields[1])
        const r = Number(fields[2])
        const p = Number(fields[3])
        if (![parsedN, r, p].every(Number.isSafeInteger) || parsedN < 2 || r < 1 || p < 1) return false
        try {
          const salt = Buffer.from(fields[4], 'base64url')
          const expected = Buffer.from(fields[5], 'base64url')
          // A malformed/hostile stored hash must not allocate arbitrary amounts of memory.
          if (parsedN > SCRYPT_N || r > SCRYPT_R || p > SCRYPT_P || salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false
          const actual = await derive(password, salt, parsedN, r, p)
          return timingSafeEqual(actual, expected)
        } catch {
          return false
        }
      }

      // Better Auth <=1.6.23 used `hex-salt:hex-key`, N=2^14,r=16,p=1 and normalized the
      // password to NFKC before hashing. Compatibility is verify-only; every new/change/reset hash
      // uses the exact password bytes and the stronger versioned profile above.
      const legacy = hash.split(':')
      if (legacy.length !== 2 || !/^[0-9a-f]{32}$/i.test(legacy[0]) || !/^[0-9a-f]{128}$/i.test(legacy[1])) return false
      try {
        const expected = Buffer.from(legacy[1], 'hex')
        const actual = await derive(password.normalize('NFKC'), Buffer.from(legacy[0], 'utf8'), 2 ** 14, 16, 1)
        return timingSafeEqual(actual, expected)
      } catch {
        return false
      }
    },
  }
}

export const PASSWORD_CONTEXT_WORDS = [
  'capacitylens',
  'capacity-lens',
  'capacity lens',
  'administrator',
  'adminadmin',
] as const

export class PasswordPolicyError extends Error {
  readonly code = 'PASSWORD_COMPROMISED'
}

async function boundedResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_HIBP_RESPONSE_BYTES) {
    throw new RangeError('Breached-password response exceeded the configured limit.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > MAX_HIBP_RESPONSE_BYTES) {
      await reader.cancel()
      throw new RangeError('Breached-password response exceeded the configured limit.')
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
}

export function assertNoContextSpecificPassword(password: string): void {
  const lowered = password.toLocaleLowerCase('en-GB')
  if (PASSWORD_CONTEXT_WORDS.some((word) => lowered.includes(word))) {
    throw new PasswordPolicyError('Choose a password that does not contain the product name or an administrative role.')
  }
}

/**
 * Pwned Passwords range lookup: only the first five SHA-1 characters leave the process (k-anonymity).
 * A failed lookup fails password creation closed; sign-in verification never calls the service.
 */
export async function assertPasswordNotBreached(
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
  const prefix = digest.slice(0, 5)
  const suffix = digest.slice(5)
  let response: Response
  try {
    response = await hibpQueue.run(
      () => fetcher(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'CapacityLens password checker' },
        signal: AbortSignal.timeout(5_000),
        // The destination is fixed. Do not let a compromised endpoint turn an HTTP redirect into
        // an application-layer SSRF primitive; an unexpected redirect fails closed like an outage.
        redirect: 'error',
      }),
    )
  } catch (cause) {
    throw new PasswordPolicyError('The breached-password check is temporarily unavailable; try again later.', { cause })
  }
  if (!response.ok) {
    throw new PasswordPolicyError(`The breached-password check failed with HTTP ${response.status}; try again later.`)
  }
  let responseText: string
  try {
    responseText = await boundedResponseText(response)
  } catch (cause) {
    throw new PasswordPolicyError('The breached-password response was invalid; try again later.', { cause })
  }
  const found = responseText.split(/\r?\n/).some((line) => line.split(':', 1)[0]?.toUpperCase() === suffix)
  if (found) throw new PasswordPolicyError('This password appears in a known breach. Choose a different password.')
}
