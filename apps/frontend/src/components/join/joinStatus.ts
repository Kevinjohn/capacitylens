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

/** Decode the scoped Google join intent without trusting optional fields. */

export function readStatus(value: unknown): {
  state: "expired" | "pending" | "approved";
  accountId?: string;
  purpose?: string;
  providerId?: string;
  email?: string;
  emailHint?: string;
  deliveryUnavailable?: boolean;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.state !== "expired" && row.state !== "pending" && row.state !== "approved") return null;
  return {
    state: row.state,
    ...(typeof row.accountId === "string" ? { accountId: row.accountId } : {}),
    ...(typeof row.purpose === "string" ? { purpose: row.purpose } : {}),
    ...(typeof row.providerId === "string" ? { providerId: row.providerId } : {}),
    ...(typeof row.email === "string" ? { email: row.email } : {}),
    ...(typeof row.emailHint === "string" ? { emailHint: row.emailHint } : {}),
    ...(row.deliveryUnavailable === true ? { deliveryUnavailable: true } : {}),
  };
}

type JoinStatus = NonNullable<ReturnType<typeof readStatus>>;

type JoinStatusResult =
  | { matched: false }
  | {
      matched: true;
      stage: "entry" | "pending" | "approved";
      providerId: string | null;
      email?: string;
      emailHint: string;
      deliveryUnavailable: boolean;
    };

/** Resolves a decoded Google callback intent for the current company and join purpose. */
export function resolveJoinStatus(input: {
  accountId: string;
  purpose?: string;
  status: JoinStatus;
}): JoinStatusResult {
  const { accountId, purpose, status } = input;
  if (
    status.accountId !== accountId ||
    (purpose !== undefined && status.purpose !== purpose) ||
    (status.purpose !== "policy" && status.purpose !== "invitation") ||
    status.state === "expired" ||
    status.providerId !== "google"
  )
    return { matched: false };
  const stage = status.state === "pending" ? "pending" : "approved";
  return {
    matched: true,
    stage,
    providerId: status.providerId ?? null,
    ...(status.email ? { email: status.email } : {}),
    emailHint: status.emailHint ?? "",
    deliveryUnavailable: status.deliveryUnavailable === true,
  };
}
