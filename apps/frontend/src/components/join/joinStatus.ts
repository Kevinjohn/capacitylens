/** Company sign-in capabilities decoded from the public metadata endpoint. */
export interface Metadata {
  companyName: string;
  passwordAvailable: boolean;
  providerAvailable: boolean;
  emailVerificationAvailable: boolean;
}

/** Decode metadata, returning null when required fields are invalid. */
export function readMetadata(value: unknown): Metadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.companyName !== "string" ||
    !row.companyName.trim() ||
    typeof row.passwordAvailable !== "boolean" ||
    typeof row.providerAvailable !== "boolean"
  )
    return null;
  return {
    companyName: row.companyName,
    passwordAvailable: row.passwordAvailable,
    providerAvailable: row.providerAvailable,
    emailVerificationAvailable: row.emailVerificationAvailable === true,
  };
}
