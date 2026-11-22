import { errors as vineErrors } from '@vinejs/vine';

/** The sentence a sign-in or sign-up answers a refused request body with. */
export function requireAuthRequestMessage(error: unknown, operation: 'sign-in' | 'sign-up') {
  if (!(error instanceof vineErrors.E_VALIDATION_ERROR)) throw error;
  const shape = error.messages.some(
    (message: { rule: string }) => message.rule === 'unknownField' || message.rule === 'object'
  );
  return shape
    ? `Invalid ${operation} request.`
    : operation === 'sign-in'
      ? 'Invalid email or password.'
      : 'Invalid sign-up details.';
}
