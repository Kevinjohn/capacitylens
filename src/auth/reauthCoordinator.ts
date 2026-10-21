// Concurrent freshness refusals share one pending promise and one dialog so callers outside React can await the same authentication result.

/** Security-sensitive account action that may require fresh authentication. */
export type ReauthAction =
  | "connect-provider"
  | "correct-member-email"
  | "remove-federated-link"
  | "delete-company"
  | "change-sign-in-tracking"
  | "change-member-role"
  | "change-member-status"
  | "remove-member"
  | "transfer-ownership"
  | "issue-password-reset"
  | "revoke-member-sessions"
  | "create-invitation"
  | "revoke-invitation"
  | "lifecycle-archive"
  | "lifecycle-restore"
  | "lifecycle-delete"
  | "lifecycle-purge";

/** Result delivered to callers when the shared re-authentication flow finishes. */
export type ReauthResult = { kind: "authenticated" } | { kind: "cancelled" };

type Resolver = (result: ReauthResult) => void;

/** Final liveness backstop when no React host survives to cancel the request immediately. */
export const REAUTH_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

let pending: {
  promise: Promise<ReauthResult>;
  resolve: Resolver;
  timeout: ReturnType<typeof setTimeout>;
  action: ReauthAction | null;
} | null = null;
let resolution = { epoch: 0, outcome: null as ReauthResult | null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Ask the user to re-authenticate (step-up). Returns a promise that resolves with an `authenticated`
 * result once they have a fresh session, or a `cancelled` result if they cancel. Concurrent calls while a request is already pending share
 * that one promise (and thus one dialog), so a burst of SESSION_NOT_FRESH failures raises a single
 * step-up, and every caller retries together once it resolves. Total: never rejects.
 */
export function requestReauth(action: ReauthAction | null = null): Promise<ReauthResult> {
  if (pending) return pending.promise;
  let resolve!: Resolver;
  const promise = new Promise<ReauthResult>((resolvePromise) => {
    resolve = resolvePromise;
  });
  const timeout = setTimeout(() => completeReauth({ reauthenticated: false }), REAUTH_REQUEST_TIMEOUT_MS);
  pending = { promise, resolve, timeout, action };
  emit();
  return promise;
}

// A successful re-authentication allows waiting requests to retry; cancellation preserves their original refusal.
type CompleteReauthOptions = { reauthenticated: boolean };
/** Resolves the pending re-authentication request and releases waiting callers. */
export function completeReauth({ reauthenticated }: CompleteReauthOptions): void {
  const current = pending;
  if (!current) return;
  pending = null;
  const result: ReauthResult = reauthenticated ? { kind: "authenticated" } : { kind: "cancelled" };
  resolution = { epoch: resolution.epoch + 1, outcome: result };
  clearTimeout(current.timeout);
  emit();
  current.resolve(result);
}

/** Last completed step-up, used to collapse late responses from the same request burst. */
export function readReauthResolution(): Readonly<{ epoch: number; outcome: ReauthResult | null }> {
  return resolution;
}

/** Snapshot for useSyncExternalStore, whether a step-up dialog should currently be shown. */
export function isReauthPending(): boolean {
  return pending !== null;
}

/** The user-facing action attached to the current step-up request, if one was supplied. */
export function readReauthAction(): ReauthAction | null {
  return pending?.action ?? null;
}

/** Subscribe to pending-state changes (useSyncExternalStore). Returns an unsubscribe. */
export function subscribeReauth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
