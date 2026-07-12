/**
 * Best-effort read of the server's `{ error }` JSON body off a failed API response.
 *
 * The API's non-OK responses carry a friendly, user-facing sentence in `body.error`; every call
 * site prefers it over its own status-stamped fallback. This helper centralises that idiom and,
 * unlike the `as { error?: string }` cast it replaces, VALIDATES the untrusted body: only a
 * non-empty string `error` on an object body is returned — anything else (unreadable body,
 * non-object JSON, missing/empty/non-string `error`) yields `undefined` so the caller's fallback
 * message applies.
 *
 * The internal `.catch(() => null)` is a sanctioned swallow per DEFENSIVE-CODING.md §5
 * (best-effort diagnostics): it drops only the nice-to-have server-authored detail, never the
 * operation — the caller has already branched on `res.ok`/status and always surfaces SOME message.
 */
export async function readApiError(res: Response): Promise<string | undefined> {
  const body: unknown = await res.json().catch(() => null)
  if (typeof body !== 'object' || body === null) return undefined
  const error = (body as { error?: unknown }).error
  return typeof error === 'string' && error.length > 0 ? error : undefined
}
