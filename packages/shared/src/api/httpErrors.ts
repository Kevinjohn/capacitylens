import { isRecord } from '../lib/isRecord.js';

/** Product codes consumed by browser flows; dependency and future codes remain open on the wire. */
export const PRODUCT_ERROR_CODES = [
  'E_INVALID_JSON',
  'E_INVALID_JSON_SHAPE',
  'E_PAYLOAD_TOO_LARGE',
  'E_UNSUPPORTED_MEDIA_TYPE',
  'E_NOT_FOUND',
  'E_ADMISSION_REQUIRED',
  'E_PASSWORD_CONFIRMATION_REQUIRED',
  'E_FIRST_COMPANY_PENDING',
  'E_IDENTITY_AUTHORIZATION_DENIED',
  'E_ACCOUNT_MEMBERSHIP_LOST',
  'E_AUTHORIZATION_DENIED',
  'E_STALE_REVISION',
  'E_MUTATION_ID_REUSED',
  'E_NO_CHANGE',
  'E_RESTORATION_CONFIRMATION_REQUIRED',
  'E_RESTORATION_CONFIRMATION_STALE',
  'E_INVALID_TOKEN',
  'E_PASSWORD_TOO_SHORT',
  'E_PASSWORD_TOO_LONG',
  'E_MAIL_UNAVAILABLE',
  'E_EMAIL_IN_USE',
  'E_VERIFICATION_COMMITTED',
  'E_CREDENTIAL_UPDATE_COMMITTED',
  'E_ACCOUNT_DELETION_COMMITTED',
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
        | 'E_ADMISSION_REQUIRED'
        | 'E_RESTORATION_CONFIRMATION_REQUIRED'
        | 'E_RESTORATION_CONFIRMATION_STALE'
        | 'E_VERIFICATION_COMMITTED'
        | 'E_CREDENTIAL_UPDATE_COMMITTED'
        | 'E_ACCOUNT_DELETION_COMMITTED'
      >;
    }
  | { error: string; code: 'E_ADMISSION_REQUIRED'; decision: object }
  | {
      error: string;
      code: 'E_RESTORATION_CONFIRMATION_REQUIRED' | 'E_RESTORATION_CONFIRMATION_STALE';
      restorableItemCount: number;
    }
  | {
      error: string;
      code:
        | 'E_VERIFICATION_COMMITTED'
        | 'E_CREDENTIAL_UPDATE_COMMITTED'
        | 'E_ACCOUNT_DELETION_COMMITTED';
      committed: true;
    };

/**
 * The first message of the framework's validation answer, `{ errors: [{ message, ... }] }`. Every
 * validation refusal, request or domain, answers 422 with it.
 */
export function readValidationMessage(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.errors)) return undefined;
  const first: unknown = value.errors[0];
  return isRecord(first) && typeof first.message === 'string' ? first.message : undefined;
}

/** Narrows untrusted HTTP JSON without changing status or mistaking transport failures for responses. */
export function readHttpErrorBody(value: unknown, fallback: string): HttpErrorBody {
  if (!isRecord(value)) return { error: fallback };
  return {
    error:
      typeof value.error === 'string' ? value.error : (readValidationMessage(value) ?? fallback),
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    ...(isRecord(value.decision) ? { decision: value.decision } : {}),
    ...(typeof value.committed === 'boolean' ? { committed: value.committed } : {}),
    ...(typeof value.restorableItemCount === 'number' &&
    Number.isSafeInteger(value.restorableItemCount) &&
    value.restorableItemCount >= 0
      ? { restorableItemCount: value.restorableItemCount }
      : {}),
  };
}
