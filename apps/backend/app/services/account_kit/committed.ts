import { DeliveryError, PostCommitError } from 'adonisjs-account-kit/errors';

/**
 * Whether the Account Kit committed the change before failing. A failed notification raises
 * `DeliveryError`, any other follow-up `PostCommitError`; neither may be repeated.
 */
export function isCommittedFailure(error: unknown) {
  return error instanceof PostCommitError || error instanceof DeliveryError;
}
