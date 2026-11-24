import { isRecord } from '../lib/isRecord.js';

/** Product codes consumed by browser flows; dependency and future codes remain open on the wire. */
export const PRODUCT_ERROR_CODES = [
  'INVALID_JSON',
  'INVALID_JSON_SHAPE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'NOT_FOUND',
  'ADMISSION_REQUIRED',
  'PASSWORD_CONFIRMATION_REQUIRED',
  'FIRST_COMPANY_PENDING',
  'IDENTITY_AUTHORIZATION_DENIED',
  'ACCOUNT_MEMBERSHIP_LOST',
  'AUTHORIZATION_DENIED',
  'STALE_REVISION',
  'MUTATION_ID_REUSED',
  'NO_CHANGE',
  'RESTORATION_CONFIRMATION_REQUIRED',
  'RESTORATION_CONFIRMATION_STALE',
  'INVALID_TOKEN',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'MAIL_UNAVAILABLE',
  'EMAIL_IN_USE',
  'VERIFICATION_COMMITTED',
  'CREDENTIAL_UPDATE_COMMITTED',
  'ACCOUNT_DELETION_COMMITTED',
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
        | 'ADMISSION_REQUIRED'
        | 'RESTORATION_CONFIRMATION_REQUIRED'
        | 'RESTORATION_CONFIRMATION_STALE'
        | 'VERIFICATION_COMMITTED'
        | 'CREDENTIAL_UPDATE_COMMITTED'
        | 'ACCOUNT_DELETION_COMMITTED'
      >;
    }
  | { error: string; code: 'ADMISSION_REQUIRED'; decision: object }
  | {
      error: string;
      code: 'RESTORATION_CONFIRMATION_REQUIRED' | 'RESTORATION_CONFIRMATION_STALE';
      restorableItemCount: number;
    }
  | {
      error: string;
      code: 'VERIFICATION_COMMITTED' | 'CREDENTIAL_UPDATE_COMMITTED' | 'ACCOUNT_DELETION_COMMITTED';
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
