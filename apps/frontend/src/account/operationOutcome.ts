import type { AccountErrorCode } from '@capacitylens/shared/account/errors'
import { isRecord } from '@capacitylens/shared/lib/isRecord'

// These currently defined 409 codes prove that the server reached a terminal refusal. A new or
// malformed code stays unknown, so the screen re-reads state instead of reporting a refusal.
const TERMINAL_OPERATION_CONFLICT_CODES = new Set<string>([
  'E_INVITATION_USED',
  'E_CONFLICT',
  'E_AUTHORIZATION_CHANGED',
  'E_IDEMPOTENCY_CONFLICT',
] satisfies readonly AccountErrorCode[])
// The server refuses an emailed operation without mail delivery before it writes anything.
const TERMINAL_SERVER_CODES = new Set<string>(['E_MAIL_UNAVAILABLE'])

async function readResponseBody(response: Response, parsedBody: unknown): Promise<unknown> {
  if (parsedBody !== undefined) return parsedBody
  return response.clone().json()
}

/** HTTP responses for which the client cannot prove whether a operation committed. */
export async function readUnknownAccountOperationOutcome(
  response: Response,
  parsedBody?: unknown
): Promise<boolean> {
  if (response.status === 408) return true
  const terminalCodes =
    response.status >= 500
      ? TERMINAL_SERVER_CODES
      : response.status === 409
        ? TERMINAL_OPERATION_CONFLICT_CODES
        : null
  if (!terminalCodes) return false
  try {
    const body = await readResponseBody(response, parsedBody)
    if (!isRecord(body)) return true
    const code = body.code
    return typeof code !== 'string' || !terminalCodes.has(code)
  } catch {
    // Status alone cannot distinguish a terminal refusal from an in-flight operation. The outcome
    // stays unknown unless a readable, known code proves finality.
    return true
  }
}
