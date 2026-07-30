export const EXTERNAL_NAVIGATION_TIMEOUT_MS = 10_000;

interface ExternalSignInResult {
  data?: { url?: string | null } | null;
  error?: { message?: string | null } | null;
}

function externalRedirectUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Own the redirect lifecycle shared by social and OIDC invite sign-in.
 *
 * The caller disables Better Auth's internal redirect, so this helper owns both the abortable
 * provider request and the single navigation requested from its returned URL. Keep the action busy
 * until pagehide proves that navigation started, or until a documented bound expires. If the page
 * later returns from bfcache, the surviving pageshow listener restores a usable form.
 */
export async function runExternalSignIn({
  start,
  onFailure,
  onRequestError,
  onCachedReturn,
  navigate = (url) => window.location.assign(url),
  navigationTimeoutMs = EXTERNAL_NAVIGATION_TIMEOUT_MS,
}: {
  /** Start the provider request and forward this signal to its transport. The timeout aborts the
   * request before retry controls are restored, so a superseded response cannot reach Better Auth's
   * internal redirect hook. A redirect that already started is instead owned by pagehide/pageshow. */
  start: (signal: AbortSignal) => Promise<ExternalSignInResult>;
  onFailure: (message?: string) => void;
  onRequestError: (error: unknown) => void;
  onCachedReturn: () => void;
  navigate?: (url: string) => void;
  navigationTimeoutMs?: number;
}): Promise<void> {
  const requestController = new AbortController();
  let navigationStarted = false;
  let resolveNavigation: (() => void) | null = null;
  const navigation = new Promise<{ kind: "navigation" }>((resolve) => {
    resolveNavigation = () => resolve({ kind: "navigation" });
  });
  let timeout: ReturnType<typeof window.setTimeout> | null = null;
  const deadline = new Promise<{ kind: "timeout" }>((resolve) => {
    timeout = window.setTimeout(() => {
      // Resolve the timeout race first, then synchronously abort the old request before its failure
      // callback unlocks retry controls. If abort rejection and the timer settle in the same turn,
      // the user therefore sees the timeout outcome rather than a misleading network-error outcome.
      resolve({ kind: "timeout" });
      requestController.abort();
    }, navigationTimeoutMs);
  });
  const markNavigation = () => {
    navigationStarted = true;
    // A page restored from bfcache can accept a new sign-in attempt. Retire the request owned by
    // the page that left before resolving the race, so it cannot later compete with that retry.
    requestController.abort();
    resolveNavigation?.();
  };
  const restoreAfterCachedNavigation = (event: PageTransitionEvent) => {
    if (event.persisted) onCachedReturn();
  };
  window.addEventListener("pagehide", markNavigation, { once: true });
  window.addEventListener("pageshow", restoreAfterCachedNavigation, { once: true });
  try {
    // Invoke the SDK on a promise boundary so a synchronous provider/configuration throw follows
    // the same recovery path as an asynchronously rejected provider request.
    const startOutcome = Promise.resolve()
      .then(() => start(requestController.signal))
      .then(
        (result) => ({ kind: "result" as const, result }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
    const outcome = await Promise.race([startOutcome, navigation, deadline]);
    if (outcome.kind === "navigation") return;
    if (outcome.kind === "timeout") {
      onFailure();
      return;
    }
    if (outcome.kind === "error") {
      onRequestError(outcome.error);
      return;
    }
    if (outcome.result.error) {
      onFailure(outcome.result.error.message ?? undefined);
      return;
    }
    const redirectUrl = externalRedirectUrl(outcome.result.data?.url);
    if (!redirectUrl) {
      onFailure();
      return;
    }
    try {
      navigate(redirectUrl);
    } catch (error) {
      onRequestError(error);
      return;
    }
    const navigationOutcome = await Promise.race([navigation, deadline]);
    if (navigationOutcome.kind === "timeout") onFailure();
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
    window.removeEventListener("pagehide", markNavigation);
    // A bfcache-restored page needs this listener after pagehide. Otherwise clean it up now.
    if (!navigationStarted) window.removeEventListener("pageshow", restoreAfterCachedNavigation);
  }
}
