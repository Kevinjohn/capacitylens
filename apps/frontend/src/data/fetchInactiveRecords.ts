import { APP_DATA_KEYS } from '@capacitylens/shared/types/entities';
import { readApiData } from '@/api/readApiData';
import type { AppData, ID } from '@capacitylens/shared/types/entities';
import { isRecord } from '@capacitylens/shared/lib/isRecord';
import { readApiError } from '@/lib/readApiError';
import { buildApiReadRouteUrl } from '@/api/queryClient';
import { fetchApi, API_BULK_TIMEOUT_MS } from './requestTimeout';

// The shared inactive-set reader checks the company projection is structurally complete so the archived-records section cannot accept a partial response. The rows are the server's own; it does not re-validate them.

/**
 * A non-OK response from the inactive-set read. Carries the raw {@link status} so callers can
 * branch on it (ArchivedSection self-hides the whole section on a 403, an expected non-admin
 * outcome, not an error to toast) and the server's friendly `{ error }` sentence when the body
 * offered one, so callers can prefer it over their own status-stamped fallback.
 */
export class InactiveRecordsHttpError extends Error {
  readonly status: number;
  /** The server-authored user-facing sentence off the error body, if it carried one. */
  readonly serverMessage: string | undefined;
  constructor(status: number, serverMessage: string | undefined) {
    // The raw message is a developer-grade fallback; callers surface their own i18n sentence.
    super(serverMessage ?? `GET /api/v1/state?includeInactive=1 failed (${status})`);
    this.name = 'InactiveRecordsHttpError';
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/**
 * A 200 body that is not a structurally complete set (see the guard in
 * {@link fetchInactiveRecords}). Typed so callers can distinguish "the server refused" from "the
 * server answered with something that is not our data" and word their surfaces accordingly.
 */
export class InactiveRecordsShapeError extends Error {
  constructor() {
    super('The server returned a structurally incomplete set (missing or non-array tables).');
    this.name = 'InactiveRecordsShapeError';
  }
}

/**
 * Fetches one complete company set including inactive rows and checks that every table is present
 * and that it holds exactly the requested company.
 *
 * @throws InactiveRecordsHttpError for non-success HTTP status; InactiveRecordsShapeError for a missing or non-array table or the wrong company. Transport and decoding errors propagate.
 */
export async function fetchInactiveRecords(companyId: ID, signal?: AbortSignal): Promise<AppData> {
  const res = await fetchApi(
    buildApiReadRouteUrl('api.company_state.show', { query: { companyId, includeInactive: '1' } }),
    { credentials: 'include', ...(signal ? { signal } : {}) },
    // The complete (archived + soft-deleted) set is the heaviest read the app makes, the bulk
    // tier, not the interactive 15s, so a large company's archived records aren't aborted mid-flight.
    API_BULK_TIMEOUT_MS,
  );
  if (!res.ok) throw new InactiveRecordsHttpError(res.status, await readApiError(res));
  const body: unknown = await readApiData(res);
  if (!isRecord(body) || !APP_DATA_KEYS.every((key) => Array.isArray(body[key]))) {
    throw new InactiveRecordsShapeError();
  }
  const companies = body.companies as unknown[];
  const company = companies[0];
  if (companies.length !== 1 || !isRecord(company) || company.id !== companyId) {
    throw new InactiveRecordsShapeError();
  }
  return body as unknown as AppData;
}
