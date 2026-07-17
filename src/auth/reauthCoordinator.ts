// Re-auth coordinator (DEFECT B — SESSION_NOT_FRESH step-up). The seam that lets the step-up flow
// span the React / non-React boundary: `apiFetchReauth` is a plain async function called from inside
// event handlers (NOT a hook), so it cannot itself render the "Confirm it's you" dialog. Instead it
// calls `requestReauth()` here — a module-level singleton that flips a pending flag and hands back a
// promise — and the React `ReauthMount` (in AuthProvider) subscribes to that flag, renders the
// dialog, and calls `resolveReauth(true|false)` when the user finishes or cancels.
//
// WHY a singleton (not React state / a store): the request originates OUTSIDE React and MUST be
// awaited by non-React code. A single global pending request is also exactly the semantics we want —
// several security actions failing with SESSION_NOT_FRESH at once DE-DUPE onto ONE dialog (they all
// share the same promise and all retry once it resolves), rather than stacking N identical dialogs.

type Resolver = (reauthenticated: boolean) => void

// The ONE in-flight re-auth request, or null. Holds the promise every concurrent caller awaits plus
// the resolver the dialog fulfils. Never two at once — see the de-dupe in requestReauth.
let pending: { promise: Promise<boolean>; resolve: Resolver } | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/**
 * Ask the user to re-authenticate (step-up). Returns a promise that resolves `true` once they have a
 * fresh session, or `false` if they cancel. Concurrent calls while a request is already pending SHARE
 * that one promise (and thus one dialog) — so a burst of SESSION_NOT_FRESH failures raises a single
 * step-up, and every caller retries together once it resolves. Total: never rejects.
 */
export function requestReauth(): Promise<boolean> {
  if (pending) return pending.promise
  let resolve!: Resolver
  const promise = new Promise<boolean>((r) => {
    resolve = r
  })
  pending = { promise, resolve }
  emit()
  return promise
}

/** Fulfil the pending re-auth request. `true` = the session was refreshed (callers retry); `false` =
 *  cancelled (callers surface the original error). No-op when nothing is pending. */
export function resolveReauth(reauthenticated: boolean): void {
  const current = pending
  pending = null
  emit()
  current?.resolve(reauthenticated)
}

/** Snapshot for useSyncExternalStore — whether a step-up dialog should currently be shown. */
export function reauthPending(): boolean {
  return pending !== null
}

/** Subscribe to pending-state changes (useSyncExternalStore). Returns an unsubscribe. */
export function subscribeReauth(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
