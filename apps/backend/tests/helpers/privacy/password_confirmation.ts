import type { ApiClient } from '@japa/api-client';
import { asDataOwner } from '#tests/helpers/authenticated_data_fixture';
import { fixturePassword } from '#tests/helpers/identities';

/** The company the password confirmation specs work in. */
export const companyId = 'a-studio';

/** The refusal of an action that needs a fresh password confirmation. */
export const confirmationRequired = {
  error: 'Confirm this action again.',
  code: 'E_PASSWORD_CONFIRMATION_REQUIRED',
};

/** A valid request for an anonymisation proof in `a-studio`. */
export const anonymiseProofRequest = {
  action: 'anonymise' as const,
  companyId,
  intent: {},
  password: fixturePassword,
};

/** Requests a password confirmation with a real sign-in cookie. */
export function issueProof(client: ApiClient, cookie: string, input = anonymiseProofRequest) {
  return asDataOwner(client.visit('api.password_confirmations.store'), cookie).json(input).send();
}
