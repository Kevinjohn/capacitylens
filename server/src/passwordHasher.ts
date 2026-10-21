import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { BoundedWorkQueue } from "./workQueue";
import { readCurrentRequestAbortSignal, reportCurrentRequestQueueSaturation } from "./requestAbort";

// OWASP Password Storage Cheat Sheet minimum scrypt profile: N=2^17, r=8, p=1.
// The format is versioned so parameters can be raised and legacy Better Auth hashes can be
// verified during a rolling upgrade without silently weakening newly-created credentials.
/**
 * Scrypt work factor used for new password hashes; stored hashes above this bound are rejected during verification.
 */
export const SCRYPT_N = 2 ** 17;
/**
 * Scrypt block size used for new password hashes and as the verification resource ceiling.
 */
export const SCRYPT_R = 8;
/**
 * Scrypt parallelization used for new password hashes and as the verification resource ceiling.
 */
export const SCRYPT_P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
/**
 * Limits simultaneous CPU and memory intensive password derivations to two.
 */
export const MAX_CONCURRENT_SCRYPT = 2;
/**
 * Limits password derivations waiting for a scrypt slot to sixteen.
 */
export const MAX_QUEUED_SCRYPT = 16;
const MAX_PASSWORD_QUEUE_WAIT_MS = 5_000;
const scryptQueue = new BoundedWorkQueue({
  maxActive: MAX_CONCURRENT_SCRYPT,
  maxQueued: MAX_QUEUED_SCRYPT,
  fullMessage: "Password processing is temporarily at capacity.",
  options: {
    maxWaitMs: MAX_PASSWORD_QUEUE_WAIT_MS,
    onSaturated: (reason) => reportCurrentRequestQueueSaturation("scrypt", reason),
  },
});

/**
 * Provides asynchronous password hashing and verification for account credentials.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(input: { hash: string; password: string }): Promise<boolean>;
}

interface DeriveInput {
  password: string;
  salt: Buffer;
  n: number;
  r: number;
  p: number;
}

interface StoredScryptHash extends DeriveInput {
  expected: Buffer;
}

function derive({ password, salt, n, r, p }: DeriveInput): Promise<Buffer> {
  const signal = readCurrentRequestAbortSignal();
  return scryptQueue.run(
    () =>
      new Promise((resolve, reject) => {
        scryptCallback(password, salt, KEY_BYTES, { N: n, r, p, maxmem: 256 * 1024 * 1024 }, (error, key) => {
          if (error) reject(error);
          else resolve(key);
        });
      }),
    signal,
  );
}

function parseStoredInteger(raw: string | undefined, minimum: number): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum ? value : undefined;
}

function hasAllowedScryptResources(input: StoredScryptHash): boolean {
  // A malformed or hostile stored hash must not allocate arbitrary amounts of memory.
  return (
    input.n <= SCRYPT_N &&
    (input.n & (input.n - 1)) === 0 &&
    input.r <= SCRYPT_R &&
    input.p <= SCRYPT_P &&
    input.salt.length === SALT_BYTES &&
    input.expected.length === KEY_BYTES
  );
}

function parseVersionedHash(fields: string[], password: string): StoredScryptHash | undefined {
  const [, rawN, rawR, rawP, rawSalt, rawExpected] = fields;
  const n = parseStoredInteger(rawN, 2);
  const r = parseStoredInteger(rawR, 1);
  const p = parseStoredInteger(rawP, 1);
  if (n === undefined || r === undefined || p === undefined || !rawSalt || !rawExpected) return undefined;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(rawSalt, "base64url");
    expected = Buffer.from(rawExpected, "base64url");
  } catch {
    // Stored representation failure is a safe credential non-match. Derivation happens
    // outside this guard so operational queue/crypto failures remain loud and retryable.
    return undefined;
  }
  const parsed = { password, salt, n, r, p, expected };
  return hasAllowedScryptResources(parsed) ? parsed : undefined;
}

async function verifyVersionedHash(fields: string[], password: string): Promise<boolean> {
  const parsed = parseVersionedHash(fields, password);
  if (!parsed) return false;
  const { expected, ...deriveInput } = parsed;
  const actual = await derive(deriveInput);
  return timingSafeEqual(actual, expected);
}

async function verifyLegacyHash(hash: string, password: string): Promise<boolean> {
  // Better Auth <=1.6.23 used `hex-salt:hex-key`, N=2^14,r=16,p=1 and normalized the
  // password to NFKC before hashing. Compatibility is verify-only; every new/change/reset hash
  // uses the exact password bytes and the stronger versioned profile above.
  const legacy = hash.split(":");
  const [legacySalt, legacyExpected] = legacy;
  if (
    !legacySalt ||
    !legacyExpected ||
    legacy.length !== 2 ||
    !/^[0-9a-f]{32}$/i.test(legacySalt) ||
    !/^[0-9a-f]{128}$/i.test(legacyExpected)
  )
    return false;
  const expected = Buffer.from(legacyExpected, "hex");
  const actual = await derive({
    password: password.normalize("NFKC"),
    salt: Buffer.from(legacySalt, "utf8"),
    n: 2 ** 14,
    r: 16,
    p: 1,
  });
  return timingSafeEqual(actual, expected);
}

/** Strong new hashes plus read-only compatibility with Better Auth's former `salt:key` format. */
export function createScryptPasswordHasher(n = SCRYPT_N): PasswordHasher {
  if (!Number.isSafeInteger(n) || n < 2 || (n & (n - 1)) !== 0) {
    throw new RangeError("scrypt N must be a power of two greater than one.");
  }
  return {
    async hash(password: string): Promise<string> {
      const salt = randomBytes(SALT_BYTES);
      const key = await derive({ password, salt, n, r: SCRYPT_R, p: SCRYPT_P });
      return `scrypt-v1$${n}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
    },
    async verify({ hash, password }): Promise<boolean> {
      const fields = hash.split("$");
      if (fields.length === 6 && fields[0] === "scrypt-v1") {
        return verifyVersionedHash(fields, password);
      }
      return verifyLegacyHash(hash, password);
    },
  };
}
