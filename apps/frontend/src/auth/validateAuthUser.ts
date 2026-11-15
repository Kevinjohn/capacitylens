import type { AuthUser } from './authContext';

interface ParseAuthUserInput {
  value: unknown;
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function isOptionalImage(value: unknown) {
  return value === undefined || value === null || typeof value === 'string';
}

/** Validates an untrusted user payload before exposing it to auth context. */
export function parseAuthUser({ value }: ParseAuthUserInput): AuthUser | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const user = value as Record<string, unknown>;
  const hasValidId = typeof user.id === 'string' && user.id.trim().length > 0;
  const hasValidName = isOptionalString(user.name);
  const hasRequiredEmail = typeof user.email === 'string' && user.email.trim().length > 0;
  const hasValidImage = isOptionalImage(user.image);
  if (![hasValidId, hasValidName, hasRequiredEmail, hasValidImage].every(Boolean)) {
    return null;
  }
  return user as unknown as AuthUser;
}
