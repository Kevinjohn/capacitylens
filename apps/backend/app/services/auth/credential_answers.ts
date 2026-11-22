import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';

/** The 503 body for a password change whose follow-up step failed after it committed. */
export const credentialUpdateCommitted = {
  error: 'Your password was changed, but a follow-up step failed. Sign in with the new password.',
  code: 'CREDENTIAL_UPDATE_COMMITTED',
  committed: true,
} satisfies ProductHttpErrorBody;
