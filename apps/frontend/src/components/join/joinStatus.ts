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

/** Decode either provider status endpoint without trusting optional fields. */
// eslint-disable-next-line complexity -- Provider status has independent optional fields from two endpoints.
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

/** Purely resolve decoded statuses; a matching Microsoft proof takes precedence over local proof. */
export function resolveJoinStatus(input: {
  accountId: string;
  purpose: string;
  local: JoinStatus;
  microsoft: JoinStatus;
}): JoinStatusResult {
  const { accountId, purpose, local, microsoft } = input;
  const microsoftMatches =
    microsoft.accountId === accountId && microsoft.purpose === purpose && microsoft.state !== "expired";
  const status = microsoftMatches ? microsoft : local;
  if (status.accountId !== accountId || status.purpose !== purpose || status.state === "expired")
    return { matched: false };
  let stage: "entry" | "pending" | "approved" = "entry";
  if (status.state === "approved") stage = "approved";
  else if (status.providerId === "microsoft") stage = "pending";
  return {
    matched: true,
    stage,
    providerId: status.providerId ?? null,
    ...(status.email ? { email: status.email } : {}),
    emailHint: status.emailHint ?? "",
    deliveryUnavailable: status.deliveryUnavailable === true,
  };
}
