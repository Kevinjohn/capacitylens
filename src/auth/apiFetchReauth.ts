import { apiFetch, API_REQUEST_TIMEOUT_MS } from '../data/requestTimeout'
import { requestReauth } from './reauthCoordinator'

// The step-up interception seam (DEFECT B). A drop-in replacement for `apiFetch` used ONLY at the
// security-sensitive call sites (member/invite management, ownership transfer, company + entity
// purge) — the exact actions the server 403s with `code: SESSION_NOT_FRESH` once the session is
// older than 15 minutes (server/src/app.ts authorize()). Ordinary reads/writes are NEVER gated by
// freshness, so they keep using plain `apiFetch` and never pay for this.
//
// WHY here, at a shared fetch wrapper (not per call site): every one of those call sites already
// does `const res = await apiFetch(...)`, so wrapping that ONE call catches all of them with a
// uniform swap and no bespoke per-handler logic. On a SESSION_NOT_FRESH response we raise the shared
// "Confirm it's you" dialog (via requestReauth), and — because the freshness check runs BEFORE the
// handler mutates anything (the 403 means the write did NOT happen) — a successful re-auth lets us
// RE-ISSUE the identical request transparently. The caller only ever sees the final Response: a 200
// after step-up, or (on cancel) the original 403 it would have surfaced anyway.

/** Peek (without consuming the body) at whether this is the server's freshness 403. Clones the
 *  response so the caller can still read the body when we hand the original back on cancel. */
async function isSessionNotFresh(res: Response): Promise<boolean> {
  if (res.status !== 403) return false
  // We must peek at the body WITHOUT consuming it — the caller still reads it (readApiError) on the
  // pass-through/cancel paths — so we read a clone. If this Response can't be cloned (only ever true
  // for a non-standard Response-like; real fetch Responses always can), there is no safe way to peek,
  // so treat it as an ordinary Forbidden and let the caller handle it — never risk eating its body.
  if (typeof res.clone !== 'function') return false
  // Best-effort per DEFENSIVE-CODING.md §5: an unreadable/non-JSON 403 body simply isn't a step-up
  // (it's an ordinary Forbidden) — fall through to the caller's existing handling, never swallow it.
  const body: unknown = await res.clone().json().catch(() => null)
  return !!body && typeof body === 'object' && (body as { code?: unknown }).code === 'SESSION_NOT_FRESH'
}

/**
 * `apiFetch` plus transparent step-up re-authentication on a SESSION_NOT_FRESH 403.
 *
 * Signature mirrors {@link apiFetch} exactly (same `input`, `init`, `timeoutMs`) so a call site
 * swaps `apiFetch` → `apiFetchReauth` with no other change. Returns the Response to react to:
 *   - not a freshness 403 → the original response, untouched;
 *   - freshness 403 + successful re-auth → the response of the RE-ISSUED request (safe: the first
 *     request was rejected before any mutation, so re-sending it is not a double-write);
 *   - freshness 403 + cancelled re-auth → the original 403, so the caller surfaces its message as
 *     it does today.
 *
 * Retries AT MOST once — a still-fresh-failing retry is returned as-is (no re-prompt loop).
 */
export async function apiFetchReauth(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number | null = API_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const res = await apiFetch(input, init, timeoutMs)
  if (!(await isSessionNotFresh(res))) return res
  const reauthenticated = await requestReauth()
  if (!reauthenticated) return res
  return apiFetch(input, init, timeoutMs)
}
