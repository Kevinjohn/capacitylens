import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import type { AuthUser } from "./authContext";
import { isReauthPending, completeReauth, readReauthAction, subscribeReauth } from "./reauthCoordinator";
import { m } from "@/i18n";

// Keep re-authentication behind a lazy boundary so the auth client is loaded only when a protected action needs interactive authentication.
const ReauthDialog = lazy(() =>
  import("./ReauthDialog").then((screenModule) => ({ default: screenModule.ReauthDialog })),
);

/** Bridges the module-level re-auth coordinator (reauthCoordinator.ts) into React: subscribes to the
 * pending flag via useSyncExternalStore and, while a SESSION_NOT_FRESH step-up is pending, renders
 * the lazy ReauthDialog. Mounted inside the authenticated provider (and only in auth-on, never
 * 'off') so it always has the live session's user; auth-off never receives a
 * freshness 403, so it needs no step-up UI. */
export function ReauthMount({ user }: { user: AuthUser | null }) {
  const pending = useSyncExternalStore(subscribeReauth, isReauthPending);
  const action = readReauthAction();
  // Unmounting this authenticated host must settle every waiting request so sign-out cannot leave non-React callers pending.
  useEffect(() => () => completeReauth({ reauthenticated: false }), []);
  if (!pending) return null;
  return (
    <Suspense fallback={<AuthLoading message={m.auth_loading_confirmation()} overlay />}>
      <ReauthDialog user={user} action={action} />
    </Suspense>
  );
}

/** Shows an accessible loading status, optionally as a full-screen overlay. */
export function AuthLoading({ message, overlay = false }: { message: string; overlay?: boolean }) {
  const status = (
    <p
      role="status"
      aria-live="polite"
      className="rounded-md bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm"
    >
      {message}
    </p>
  );
  return overlay ? (
    <div className="fixed inset-0 z-(--z-index-modal) flex items-center justify-center bg-black/40 p-6">{status}</div>
  ) : (
    <main className="flex min-h-screen items-center justify-center p-6">{status}</main>
  );
}
