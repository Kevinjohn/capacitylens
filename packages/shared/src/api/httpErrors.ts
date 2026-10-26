import { isRecord } from "../lib/isRecord.js";

/** Product codes consumed by browser flows; dependency and future codes remain open on the wire. */
export const PRODUCT_ERROR_CODES = [
  "VALIDATION_ERROR",
  "INVALID_JSON",
  "INVALID_JSON_SHAPE",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "NOT_FOUND",
  "ADMISSION_REQUIRED",
  "ACTION_PROOF_REQUIRED",
  "FIRST_COMPANY_PENDING",
  "IDENTITY_AUTHORITY_DENIED",
  "UNAUTHENTICATED",
  "ACCOUNT_MEMBERSHIP_LOST",
  "AUTHORIZATION_DENIED",
  "STALE_REVISION",
  "MUTATION_ID_REUSED",
  "NO_CHANGE",
  "RESTORATION_CONFIRMATION_REQUIRED",
  "RESTORATION_CONFIRMATION_STALE",
  "INVALID_TOKEN",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_TOO_LONG",
  "MAIL_UNAVAILABLE",
  "EMAIL_REGISTERED",
  "VERIFICATION_COMMITTED",
  "CREDENTIAL_UPDATE_COMMITTED",
] as const;

/** Known product codes are deliberately separate from arbitrary dependency response codes. */
export type ProductErrorCode = (typeof PRODUCT_ERROR_CODES)[number];

/** Flat wire body shared by product handlers and browser boundaries; unknown codes are preserved. */
export interface HttpErrorBody {
  error: string;
  code?: string;
  decision?: object;
  committed?: boolean;
  restorableItemCount?: number;
}

/** Known operation variants expose only their own metadata. */
export type ProductHttpErrorBody =
  | {
      error: string;
      code: Exclude<
        ProductErrorCode,
        | "ADMISSION_REQUIRED"
        | "RESTORATION_CONFIRMATION_REQUIRED"
        | "RESTORATION_CONFIRMATION_STALE"
        | "VERIFICATION_COMMITTED"
        | "CREDENTIAL_UPDATE_COMMITTED"
      >;
    }
  | { error: string; code: "ADMISSION_REQUIRED"; decision: object }
  | {
      error: string;
      code: "RESTORATION_CONFIRMATION_REQUIRED" | "RESTORATION_CONFIRMATION_STALE";
      restorableItemCount: number;
    }
  | { error: string; code: "VERIFICATION_COMMITTED" | "CREDENTIAL_UPDATE_COMMITTED"; committed: true };

/** Product validation uses 400 even though the generated client's default validation helper uses 422. */
export interface ProductValidationFailure {
  status: 400;
  body: { error: string; code: "VALIDATION_ERROR" };
}

/** Recognises only the codes the product explicitly models. */
export function isProductErrorCode(value: unknown): value is ProductErrorCode {
  return typeof value === "string" && (PRODUCT_ERROR_CODES as readonly string[]).includes(value);
}

/** Narrows untrusted HTTP JSON without changing status or mistaking transport failures for responses. */
export function readHttpErrorBody(value: unknown, fallback: string): HttpErrorBody {
  if (!isRecord(value)) return { error: fallback };
  return {
    error: typeof value.error === "string" ? value.error : fallback,
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(isRecord(value.decision) ? { decision: value.decision } : {}),
    ...(typeof value.committed === "boolean" ? { committed: value.committed } : {}),
    ...(typeof value.restorableItemCount === "number" &&
    Number.isSafeInteger(value.restorableItemCount) &&
    value.restorableItemCount >= 0
      ? { restorableItemCount: value.restorableItemCount }
      : {}),
  };
}
