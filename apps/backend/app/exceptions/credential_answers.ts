import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';

/** The 400 body for a link or token that is invalid or has expired, on every route that spends one. */
export const invalidLinkAnswer = {
  error: 'This link is invalid or expired.',
  code: 'E_INVALID_TOKEN',
} satisfies ProductHttpErrorBody;

/** The 409 body for an address that already has an account, on sign-up and invitation acceptance. */
export const emailInUseAnswer = {
  error: 'An account already uses this email. Sign in or reset your password.',
  code: 'E_EMAIL_IN_USE',
} satisfies ProductHttpErrorBody;

/** The 503 body for a password change whose follow-up step failed after it committed. */
export const credentialUpdateCommitted = {
  error: 'Your password was changed, but a follow-up step failed. Sign in with the new password.',
  code: 'E_CREDENTIAL_UPDATE_COMMITTED',
  committed: true,
} satisfies ProductHttpErrorBody;
