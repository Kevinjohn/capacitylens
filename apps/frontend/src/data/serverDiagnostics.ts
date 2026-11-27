import { requestApiResponse } from '@/api/queryClient'
import { isRecord } from '@capacitylens/shared/lib/isRecord'

/** One server diagnostics read: the decoded body, or null when it was unreadable, and when it ran. */
export interface ServerDiagnosticsObservation {
  response: unknown
  observedAt: string
}

/**
 * Reads the server's diagnostics once. The body is left for `readDiagnostics` to validate, so a
 * refused or unreadable answer still yields an observation that the fixed projection reports.
 *
 * @throws The fetch failure when the server cannot be reached.
 */
export async function readServerDiagnostics(
  signal?: AbortSignal
): Promise<ServerDiagnosticsObservation> {
  const response = await requestApiResponse('api.diagnostics.show', signal ? { signal } : {})
  // An unreadable body is represented as an unavailable server in the fixed projection.
  const body: unknown = await response.json().catch(() => null)
  // A 200 answer is wrapped in `data`; the 503 answer is flat.
  return {
    response: response.ok && isRecord(body) ? body.data : body,
    observedAt: new Date().toISOString(),
  }
}
