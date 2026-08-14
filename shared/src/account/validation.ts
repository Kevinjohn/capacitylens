import {
  hasDisallowedChars,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  unicodeCharacterCount,
  utf8ByteLength,
} from "../lib/strings";
import { MAX_PASSWORD_LENGTH, passwordCharacterCount, passwordLengthFailure } from "../domain/password";
import type { BoundApplication } from "./types";

/** Maximum number of application-specific terms screened from each password. */
export const MAX_ACCOUNT_PASSWORD_CONTEXT_WORDS = 32;
const INVALID_APPLICATION_BINDING = "The account application binding could not be validated.";
const OPAQUE_CREDENTIAL_RE = /^[A-Za-z0-9_-]{16,128}$/;

function hasOpaqueCredentialShape(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_CREDENTIAL_RE.test(value);
}

/** The shared bound every human-readable application label must satisfy: a non-blank,
 * control-safe string of at most MAX_NAME_LENGTH characters. */
function hasBoundedNameShape(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !hasDisallowedChars(value) &&
    unicodeCharacterCount(value) <= MAX_NAME_LENGTH
  );
}

/** Validate the reconciliation handle for one account command. */
export function isAccountCommandId(value: unknown): value is string {
  return hasOpaqueCredentialShape(value);
}

/** Validate the independent idempotency key for one account command. */
export function isAccountIdempotencyKey(value: unknown): value is string {
  return hasOpaqueCredentialShape(value);
}

/** Validate an identity-provider session id before displaying or revoking it. */
export function isAccountSessionId(value: unknown): value is string {
  return hasOpaqueCredentialShape(value);
}

/** Validate the per-tab session id used to order browser sync batches. */
export function isBrowserSyncSessionId(value: unknown): value is string {
  return hasOpaqueCredentialShape(value);
}

/**
 * Validate an untrusted application binding without throwing.
 *
 * @returns A display-safe description of the first invalid field, or `null` when the complete
 * application id, display branding and password-context vocabulary satisfy their shared bounds.
 */
export function boundApplicationFailure(application: unknown): string | null {
  try {
    return inspectBoundApplication(application);
  } catch {
    // This is an exported unknown-input boundary. Proxies and accessor-bearing objects may throw
    // during any structural read; contain them without exposing their exception text to callers.
    return INVALID_APPLICATION_BINDING;
  }
}

function inspectBoundApplication(application: unknown): string | null {
  if (typeof application !== "object" || application === null || Array.isArray(application)) {
    return "The account application binding must be an object.";
  }
  const candidate = application as Partial<BoundApplication>;
  if (typeof candidate.applicationId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(candidate.applicationId)) {
    return "The account application id must match ^[a-z0-9][a-z0-9_-]{0,63}$.";
  }
  if (!hasBoundedNameShape(candidate.displayName)) {
    return `The account application display name must be 1–${MAX_NAME_LENGTH} characters.`;
  }
  const branding = candidate.branding;
  if (
    typeof branding !== "object" ||
    branding === null ||
    Array.isArray(branding) ||
    !hasBoundedNameShape(branding.totpIssuer) ||
    !hasBoundedNameShape(branding.defaultProviderLabel) ||
    !Array.isArray(branding.passwordContextWords) ||
    branding.passwordContextWords.length === 0 ||
    branding.passwordContextWords.length > MAX_ACCOUNT_PASSWORD_CONTEXT_WORDS ||
    Array.from(branding.passwordContextWords).some(
      (word) =>
        typeof word !== "string" ||
        !word.trim() ||
        hasDisallowedChars(word) ||
        passwordCharacterCount(word) > MAX_PASSWORD_LENGTH,
    )
  ) {
    return `Account branding must define a TOTP issuer and provider label of at most ${MAX_NAME_LENGTH} characters, plus 1–${MAX_ACCOUNT_PASSWORD_CONTEXT_WORDS} non-empty password context words of at most ${MAX_PASSWORD_LENGTH} characters each.`;
  }
  return null;
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

/** Stable failure vocabulary returned by {@link validateCredentialInput}. */
export type CredentialInputFailure = "email" | "display-name" | "password-length";

/**
 * Validate normalized identity credentials at the shared adapter boundary without throwing.
 *
 * @returns The first failing field category (`email`, `display-name`, or `password-length`), or
 * `null` when all three values meet their canonical form, character and length rules.
 */
export function validateCredentialInput(input: {
  email: string;
  displayName: string;
  password: string;
}): CredentialInputFailure | null {
  if (!isAccountEmail(input.email) || normalizeAccountEmail(input.email) !== input.email) return "email";
  if (
    input.displayName !== input.displayName.trim() ||
    input.displayName.length === 0 ||
    unicodeCharacterCount(input.displayName) > MAX_NAME_LENGTH ||
    hasDisallowedChars(input.displayName)
  )
    return "display-name";
  if (passwordLengthFailure(input.password)) {
    return "password-length";
  }
  return null;
}
