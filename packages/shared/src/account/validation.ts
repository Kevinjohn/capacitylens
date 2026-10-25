import { hasDisallowedChars, MAX_EMAIL_LENGTH, utf8ByteLength } from "../lib/strings.js";

const OPAQUE_CREDENTIAL_RE = /^[A-Za-z0-9_-]{16,128}$/;

function hasOpaqueCredentialShape(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_CREDENTIAL_RE.test(value);
}

/** Validate the reconciliation handle for one account command. */
export function isAccountCommandId(value: unknown): value is string {
  return hasOpaqueCredentialShape(value);
}

/** Validate the independent idempotency key for one account command. */
export function isAccountIdempotencyKey(value: unknown): value is string {
  return hasOpaqueCredentialShape(value);
}

/**
 * Canonicalize an account email for identity comparison and persistence.
 *
 * @returns The lower-cased input with leading and trailing whitespace removed. This pure transform
 * never throws; callers must use {@link isAccountEmail} when they also need admission validation.
 */
export function normalizeAccountEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Test whether an account email has an admissible bounded shape without throwing.
 *
 * @returns `true` only for a trimmed, control-safe, single-`@` address whose original and
 * normalized forms both fit the shared email limit. This intentionally validates shape rather than
 * attempting mailbox-deliverability or full RFC syntax validation.
 */
export function isAccountEmail(value: string): boolean {
  const normalized = normalizeAccountEmail(value);
  if (
    value.length === 0 ||
    utf8ByteLength(value) > MAX_EMAIL_LENGTH ||
    utf8ByteLength(normalized) > MAX_EMAIL_LENGTH ||
    value !== value.trim()
  )
    return false;
  if (hasDisallowedChars(value)) return false;
  return /^[^@\s]+@[^@\s]+$/.test(value);
}
