import type { AppData, ID } from "@capacitylens/shared/types/entities";
import { readApiError } from "@/lib/readApiError";
import { API_BASE } from "./apiConfig";
import { apiFetch, API_BULK_TIMEOUT_MS } from "./requestTimeout";
import { parseAccountSlice } from "./validateAccountSlice";

// The shared inactive-slice reader validates the complete tenant projection so backup and lifecycle views cannot accept a partial response.

/**
 * A non-OK response from the inactive-slice read. Carries the raw {@link status} so callers can
 * branch on it (ArchivedSection self-hides the whole section on a 403, an expected non-admin
 * outcome, not an error to toast) and the server's friendly `{ error }` sentence when the body
 * offered one, so callers can prefer it over their own status-stamped fallback.
 */
export class InactiveSliceHttpError extends Error {
  readonly status: number;
  /** The server-authored user-facing sentence off the error body, if it carried one. */
  readonly serverMessage: string | undefined;
  constructor(status: number, serverMessage: string | undefined) {
    // The raw message is a developer-grade fallback; callers surface their own i18n sentence.
    super(serverMessage ?? `GET /api/state?includeInactive=1 failed (${status})`);
    this.name = "InactiveSliceHttpError";
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/**
 * A 200 body that is not a structurally complete slice (see the guard in
 * {@link fetchInactiveSlice}). Typed so callers can distinguish "the server refused" from "the
 * server answered with something that is not our data" and word their surfaces accordingly.
 */
export class InactiveSliceShapeError extends Error {
  constructor() {
    super("The server returned a structurally incomplete slice (missing or non-array tables).");
    this.name = "InactiveSliceShapeError";
  }
}

/**
 * Fetches one structurally complete tenant slice including inactive rows, then repairs field-level defects. Repair can change invalid lifecycle state; completeness does not prove archival semantics.
 *
 * @throws InactiveSliceHttpError for non-success HTTP status; InactiveSliceShapeError for missing tables, invalid or duplicate row IDs, or rows belonging to another account. Transport and decoding errors propagate.
 */
export async function fetchInactiveSlice(accountId: ID, signal?: AbortSignal): Promise<AppData> {
  const res = await apiFetch(
    `${API_BASE}/api/state?accountId=${encodeURIComponent(accountId)}&includeInactive=1`,
    { credentials: "include", ...(signal ? { signal } : {}) },
    // The complete (archived + soft-deleted) slice is the heaviest read the app makes, the bulk
    // tier, not the interactive 15s, so a large tenant's export/backup isn't aborted mid-flight.
    API_BULK_TIMEOUT_MS,
  );
  if (!res.ok) throw new InactiveSliceHttpError(res.status, await readApiError(res));
  const body: unknown = await res.json();
  const data = parseAccountSlice(body, accountId);
  if (!data) throw new InactiveSliceShapeError();
  return data;
}
