import type { AuthUser } from "./authContext";

interface ParseAuthUserInput {
  value: unknown;
  requireEmail?: boolean | undefined;
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown) {
  return value === undefined || typeof value === "boolean";
}

function isOptionalImage(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}

export function parseAuthUser({ value, requireEmail = false }: ParseAuthUserInput): AuthUser | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const user = value as Record<string, unknown>;
  const hasValidId = typeof user.id === "string" && user.id.trim().length > 0;
  const hasValidName = isOptionalString(user.name);
  const hasRequiredEmail = !requireEmail || (typeof user.email === "string" && user.email.trim().length > 0);
  const hasValidEmail = isOptionalString(user.email);
  const hasValidTwoFactor = isOptionalBoolean(user.twoFactorEnabled);
  const hasValidImage = isOptionalImage(user.image);
  if (![hasValidId, hasValidName, hasRequiredEmail, hasValidEmail, hasValidTwoFactor, hasValidImage].every(Boolean)) {
    return null;
  }
  return user as unknown as AuthUser;
}
