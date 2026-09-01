/**
 * Best-effort read of the server's `{ error }` JSON body off a failed API response.
 *
 * The API's non-OK responses carry a friendly, user-facing sentence in `body.error`; every call
 * site prefers it over its own status-stamped fallback. This helper centralises that idiom and,
 * unlike the `as { error?: string }` cast it replaces, VALIDATES the untrusted body: only a
 * non-empty string `error` on an object body is returned — anything else (unreadable body,
 * non-object JSON, missing/empty/non-string `error`) yields `undefined` so the caller's fallback
 * message applies. A standards-compliant response is cloned before reading, so repeated calls
 * remain safe and the caller's original body stays available to a later decoder. Minimal response
 * adapters without `clone()` retain the legacy single-read behaviour.
 *
 * The internal `.catch(() => null)` is a sanctioned swallow per DEFENSIVE-CODING.md §5
 * (best-effort diagnostics): it drops only the nice-to-have server-authored detail, never the
 * operation — the caller has already branched on `res.ok`/status and always surfaces SOME message.
 */
export async function readApiError(res: Response): Promise<string | undefined> {
  let readable: Response;
  try {
    if (res.bodyUsed) return undefined;
    readable = typeof res.clone === "function" ? res.clone() : res;
  } catch {
    return undefined;
  }
  const body: unknown = await readable.json().catch(() => null);
  return apiErrorFromBody(body);
}

/** Best-effort read of a string API error code without consuming the response body. */
export async function peekApiErrorCode(res: Response): Promise<string | null> {
  if (res.bodyUsed || typeof res.clone !== "function") return null;
  let readable: Response;
  try {
    readable = res.clone();
  } catch {
    return null;
  }
  const body: unknown = await readable.json().catch(() => null);
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Validate an already-decoded API error body without reading a response. */
export function apiErrorFromBody(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "string") return undefined;
  const trimmed = error.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
