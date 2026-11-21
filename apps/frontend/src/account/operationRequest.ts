import {
  createBrowserAccountOperation,
  readOrCreateStoredOperation,
  beginOperationCohort,
  finishOperationCohort,
  markOperationCohortUnknown,
} from './accountOperations';
import type { BrowserAccountOperation } from './accountOperations';
import { operationOutcomeDecisions, readUnknownAccountOperationOutcome } from './operationOutcome';

interface RunOperationInput {
  operationKey: string | null;
  explicit: BrowserAccountOperation | undefined;
  request: (operation: BrowserAccountOperation) => Promise<Response>;
  ambiguousStatus?: number | undefined;
}

/** Runs an account mutation with a stable operation identity and classifies ambiguous outcomes. */
export async function runOperation({
  operationKey,
  explicit,
  request,
  ambiguousStatus,
}: RunOperationInput): Promise<Response> {
  const operation =
    explicit ??
    (operationKey === null
      ? createBrowserAccountOperation()
      : readOrCreateStoredOperation(operationKey));
  const cohort =
    explicit === undefined && operationKey !== null
      ? beginOperationCohort(operationKey)
      : undefined;
  try {
    const response = await request(operation);
    // A transport failure, HTTP 408, 5xx or ambiguous 409 has an unknown commit outcome, so retain
    // the same operation. A definitive success or decoded known caller/policy rejection closes it.
    const outcomeUnknown =
      response.status === ambiguousStatus || (await readUnknownAccountOperationOutcome(response));
    operationOutcomeDecisions.set(response, outcomeUnknown);
    if (outcomeUnknown && cohort) markOperationCohortUnknown(cohort);
    return response;
  } catch (error) {
    if (cohort) markOperationCohortUnknown(cohort);
    throw error;
  } finally {
    if (cohort) finishOperationCohort(cohort);
  }
}

/** Adds account operation identifiers to request headers. */
export function buildOperationRequestInit(
  requestOptions: RequestInit,
  operation = createBrowserAccountOperation(),
): RequestInit {
  const headers = new Headers(requestOptions.headers);
  headers.set('Idempotency-Key', operation.idempotencyKey);
  headers.set('X-Account-Command-Id', operation.commandId);
  return { ...requestOptions, headers };
}

/** Builds a JSON request carrying the account operation identity; `body` comes from `buildJsonBody`. */
export function buildJsonOperationRequestInit(
  // DELETE carries a body for exactly one caller: the ceremony cancellation, whose expected
  // revision is the compare half of a transition rather than an identifier, so it belongs in the
  // payload the server hashes, not in the path.
  method: 'POST' | 'PATCH' | 'DELETE',
  body: string,
  operation?: BrowserAccountOperation,
): RequestInit {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  return buildOperationRequestInit({ method, credentials: 'include', headers, body }, operation);
}
