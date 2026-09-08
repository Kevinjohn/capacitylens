export const EXTERNAL_NAVIGATION_TIMEOUT_MS = 10_000;

interface ExternalSignInResult {
  data?: { url?: string | null | undefined } | null;
  error?: { message?: string | null | undefined } | null;
}

type NavigationOutcome = { kind: "navigation" };
type TimeoutOutcome = { kind: "timeout" };
type RequestOutcome = { kind: "result"; result: ExternalSignInResult } | { kind: "error"; error: unknown };
type ExternalRedirectOutcome =
  | { kind: "failure"; message: string | null | undefined }
  | { kind: "redirect"; url: string };

function parseExternalRedirectUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function startExternalRequest(
  start: (signal: AbortSignal) => Promise<ExternalSignInResult>,
  signal: AbortSignal,
): Promise<RequestOutcome> {
  // Invoke the SDK on a promise boundary so a synchronous provider/configuration throw follows
  // the same recovery path as an asynchronously rejected provider request.
  return Promise.resolve()
    .then(() => start(signal))
    .then(
      (result) => ({ kind: "result", result }),
      (error: unknown) => ({ kind: "error", error }),
    );
}

function resolveExternalRedirect(result: ExternalSignInResult): ExternalRedirectOutcome {
  if (result.error !== undefined && result.error !== null) {
    return { kind: "failure", message: result.error.message };
  }
  const redirectUrl = parseExternalRedirectUrl(result.data?.url);
  return redirectUrl === null ? { kind: "failure", message: undefined } : { kind: "redirect", url: redirectUrl };
}

function createNavigationLifecycle(navigationTimeoutMs: number, onCachedReturn: () => void) {
  const requestController = new AbortController();
  let resolveNavigation = () => {};
  const navigation = new Promise<NavigationOutcome>((resolve) => {
    resolveNavigation = () => resolve({ kind: "navigation" });
  });
  let resolveDeadline: (outcome: TimeoutOutcome) => void = () => {};
  const deadline = new Promise<TimeoutOutcome>((resolve) => {
    resolveDeadline = resolve;
  });
  const timeout = window.setTimeout(() => {
    // Resolve the timeout race first, then synchronously abort the old request before its failure
    // callback unlocks retry controls. If abort rejection and the timer settle in the same turn,
    // the user therefore sees the timeout outcome rather than a misleading network-error outcome.
    resolveDeadline({ kind: "timeout" });
    requestController.abort();
  }, navigationTimeoutMs);
  let removeCachedReturnListener = () => {
    window.removeEventListener("pageshow", restoreAfterCachedNavigation);
  };
  function markNavigation() {
    // A page restored from bfcache can accept a new sign-in attempt. Retire the request owned by
    // the page that left before resolving the race, so it cannot later compete with that retry.
    requestController.abort();
    removeCachedReturnListener = () => {};
    resolveNavigation();
  }
  function restoreAfterCachedNavigation(event: PageTransitionEvent) {
    if (event.persisted) onCachedReturn();
  }
  window.addEventListener("pagehide", markNavigation, { once: true });
  window.addEventListener("pageshow", restoreAfterCachedNavigation, { once: true });

  return {
    requestController,
    navigation,
    deadline,
    cleanup: () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pagehide", markNavigation);
      removeCachedReturnListener();
    },
  };
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
  const lifecycle = createNavigationLifecycle(navigationTimeoutMs, onCachedReturn);
  try {
    const startOutcome = startExternalRequest(start, lifecycle.requestController.signal);
    const outcome = await Promise.race([startOutcome, lifecycle.navigation, lifecycle.deadline]);
    if (outcome.kind === "navigation") return;
    if (outcome.kind === "timeout") {
      onFailure();
      return;
    }
    if (outcome.kind === "error") {
      onRequestError(outcome.error);
      return;
    }
    const redirect = resolveExternalRedirect(outcome.result);
    if (redirect.kind === "failure") {
      onFailure(redirect.message ?? undefined);
      return;
    }
    try {
      navigate(redirect.url);
    } catch (error) {
      onRequestError(error);
      return;
    }
    const navigationOutcome = await Promise.race([lifecycle.navigation, lifecycle.deadline]);
    if (navigationOutcome.kind === "timeout") onFailure();
  } finally {
    lifecycle.cleanup();
  }
}
