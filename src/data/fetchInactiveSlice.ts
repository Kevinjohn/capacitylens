import type { AppData, ID } from '@capacitylens/shared/types/entities'
import { readApiError } from '../lib/readApiError'
import { API_BASE } from './apiConfig'
import { apiFetch, API_BULK_TIMEOUT_MS } from './requestTimeout'
import { validateAccountSlice } from './validateAccountSlice'

// The ONE client-side reader of the purge-gated admin endpoint
// `GET /api/state?accountId=…&includeInactive=1` (the P2.6 complete per-tenant read: archived +
// soft-deleted rows retained). Shared by DeleteCompanyDialog ("Export first" — the last backup
// before a no-undo cascade delete) and ArchivedSection (the Settings lifecycle admin view) so the
// two call sites can't drift on how much they trust the response — they briefly disagreed, and the
// unvalidated copy rendered a proxy error page as an empty archived list.

/**
 * A non-OK response from the inactive-slice read. Carries the raw {@link status} so callers can
 * branch on it (ArchivedSection self-hides the whole section on a 403 — an expected non-admin
 * outcome, not an error to toast) and the server's friendly `{ error }` sentence when the body
 * offered one, so callers can prefer it over their own status-stamped fallback.
 */
export class InactiveSliceHttpError extends Error {
  readonly status: number
  /** The server-authored user-facing sentence off the error body, if it carried one. */
  readonly serverMessage: string | undefined
  constructor(status: number, serverMessage: string | undefined) {
    // The raw message is a developer-grade fallback; callers surface their own i18n sentence.
    super(serverMessage ?? `GET /api/state?includeInactive=1 failed (${status})`)
    this.name = 'InactiveSliceHttpError'
    this.status = status
    this.serverMessage = serverMessage
  }
}

/**
 * A 200 body that is not a structurally complete slice (see the guard in
 * {@link fetchInactiveSlice}). Typed so callers can distinguish "the server refused" from "the
 * server answered with something that is not our data" and word their surfaces accordingly.
 */
export class InactiveSliceShapeError extends Error {
  constructor() {
    super('The server returned a structurally incomplete slice (missing or non-array tables).')
    this.name = 'InactiveSliceShapeError'
  }
}

/**
 * Fetch the COMPLETE per-tenant slice (archived + soft-deleted retained) from the purge-gated
 * admin read and return it validated + migrated.
 *
 * The body is untrusted external input — never a bare `as AppData` cast. And it must be
 * structure-checked BEFORE migrate(): this endpoint returns the bare table map (no schemaVersion
 * wrapper), so migrate() treats it as a legacy blob, coerces any absent table to [] and
 * SYNTHESIZES the built-in Internal client for every accounts row — meaning a partial body
 * (broken proxy, wrong-version server) would migrate into a nearly-empty AppData that reads as an
 * empty archived list or defeats the export's zero-record guard and gets saved as the "complete
 * last backup". Require every known table to be present as an array (KNOWN_KEYS is the
 * drift-proofed list — a new entity extends it automatically); anything less is not a complete
 * slice, so THROW ({@link InactiveSliceShapeError}) for the caller's error surface. A non-OK
 * response throws {@link InactiveSliceHttpError}. A network/parse failure rejects with the raw
 * error — the callers already route unknown failures to their surfaces.
 *
 * Once structurally complete, migrate() only normalizes/repairs records within tables, exactly
 * like ServerSyncAdapter.loadAll does for the same endpoint family.
 */
export async function fetchInactiveSlice(accountId: ID): Promise<AppData> {
  const res = await apiFetch(
    `${API_BASE}/api/state?accountId=${encodeURIComponent(accountId)}&includeInactive=1`,
    { credentials: 'include' },
    // The complete (archived + soft-deleted) slice is the heaviest read the app makes — the BULK
    // tier, not the interactive 15s, so a large tenant's export/backup isn't aborted mid-flight.
    API_BULK_TIMEOUT_MS,
  )
  if (!res.ok) throw new InactiveSliceHttpError(res.status, await readApiError(res))
  const body: unknown = await res.json()
  const data = validateAccountSlice(body, accountId)
  if (!data) throw new InactiveSliceShapeError()
  return data
}
