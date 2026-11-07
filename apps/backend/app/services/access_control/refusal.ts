import type { HttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import { AccessControlError } from '@kevinjohn/adonisjs-access-control';
import type { AccessControlErrorCode } from '@kevinjohn/adonisjs-access-control/types';

// Partial: unlisted codes (UNKNOWN_ROLE, INVALID_CONFIG, OWNER_DISABLED, SCOPE_NOT_EMPTY) are server faults.
const refusals: Partial<
  Record<AccessControlErrorCode, { status: number; code: string; error: string }>
> = {
  E_ACCESS_CONTROL_FORBIDDEN: { status: 403, code: 'FORBIDDEN', error: 'Forbidden.' },
  E_ACCESS_CONTROL_SELF_MANAGEMENT: { status: 403, code: 'FORBIDDEN', error: 'Forbidden.' },
  E_ACCESS_CONTROL_OWNER_PROTECTED: { status: 403, code: 'FORBIDDEN', error: 'Forbidden.' },
  E_ACCESS_CONTROL_RANK_TOO_LOW: { status: 403, code: 'FORBIDDEN', error: 'Forbidden.' },
  E_ACCESS_CONTROL_NOT_A_MEMBER: {
    status: 404,
    code: 'NOT_FOUND',
    error: 'Not a member of this workspace.',
  },
  E_ACCESS_CONTROL_USER_NOT_FOUND: { status: 404, code: 'NOT_FOUND', error: 'Not found.' },
  E_ACCESS_CONTROL_SCOPE_NOT_FOUND: { status: 404, code: 'NOT_FOUND', error: 'Company not found.' },
  E_ACCESS_CONTROL_ALREADY_MEMBER: {
    status: 409,
    code: 'CONFLICT',
    error: 'Already a member of this workspace.',
  },
  E_ACCESS_CONTROL_LAST_OWNER: {
    status: 409,
    code: 'LAST_OWNER',
    error: 'Transfer ownership first.',
  },
  E_ACCESS_CONTROL_CONFLICT: {
    status: 409,
    code: 'CONFLICT',
    error: 'The company changed. Try again.',
  },
  E_ACCESS_CONTROL_INVALID_INPUT: {
    status: 400,
    code: 'VALIDATION_ERROR',
    error: 'Invalid member input.',
  },
};

/** The product refusal for a recognised package error; undefined for anything else (server fault). */
export function buildAccessRefusal(
  error: unknown
): { status: number; body: HttpErrorBody } | undefined {
  if (!(error instanceof AccessControlError)) return undefined;
  const mapped = refusals[error.code];
  return mapped
    ? { status: mapped.status, body: { error: mapped.error, code: mapped.code } }
    : undefined;
}
