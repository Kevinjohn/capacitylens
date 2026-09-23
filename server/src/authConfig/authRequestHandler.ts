import type { Auth } from "./authTypes";
import {
  authHandlerErrorCapture,
  passwordResetSessionCapture,
  isFederatedAccountCoordinateConstraint,
  microsoftCallbackCapture,
} from "./captureContexts";
import { MicrosoftProofError, type MicrosoftProof } from "./microsoftProof";

type CreateAuthRequestHandlerOptions = {
  rawHandler: Auth["handler"];
  providerIdFromExternalContext: (input: { path: string }) => string | null;
  callbackErrorUrl: (request: Request) => URL;
  browserAuthErrorUrl: URL;
  commitResetSessions: (sessionHandles: readonly string[]) => void;
  reconcileFederatedLinks: () => void;
  microsoftProof: MicrosoftProof | null;
};

function redirectWithError(target: URL, error: string): Response {
  target.searchParams.set("error", error);
  return Response.redirect(target, 302);
}

function redirectCapturedCallbackError(options: {
  callbackProviderId: string | null;
  capturedError: unknown;
  failureTarget: URL | null;
  browserAuthErrorUrl: URL;
}): Response | null {
  if (!options.callbackProviderId) return null;
  const target = options.failureTarget ?? new URL(options.browserAuthErrorUrl);
  if (isFederatedAccountCoordinateConstraint(options.capturedError)) {
    return redirectWithError(target, "account_already_linked_to_different_user");
  }
  return null;
}

function reconcileCallback(options: CreateAuthRequestHandlerOptions, callbackProviderId: string | null): void {
  if (!callbackProviderId) return;
  try {
    options.reconcileFederatedLinks();
  } catch (error) {
    // The trigger already preserved the durable observation. Keep the browser response truthful
    // and let startup/request reconciliation retry the audit transaction.
    console.error("Federated identity link audit reconciliation is pending.", error);
  }
}

function preflightMicrosoftCallback(
  options: CreateAuthRequestHandlerOptions,
  request: Request,
  failureTarget: URL | null,
): Response | null {
  if (!options.microsoftProof) return null;
  try {
    options.microsoftProof.validateCallback(request);
  } catch (error) {
    if (!(error instanceof MicrosoftProofError)) throw error;
    const target =
      options.microsoftProof.errorReturnUrl(request.headers, error.code) ??
      failureTarget ??
      new URL(options.browserAuthErrorUrl);
    return redirectWithError(target, error.code);
  }
  if (!new URL(request.url).searchParams.has("error")) return null;
  const target =
    options.microsoftProof.errorReturnUrl(request.headers, "provider_cancelled") ??
    failureTarget ??
    new URL(options.browserAuthErrorUrl);
  target.searchParams.set("error", "provider_cancelled");
  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), "set-cookie": options.microsoftProof.cancel(request.headers) },
  });
}

function rewriteMicrosoftReturn(
  options: CreateAuthRequestHandlerOptions,
  request: Request,
  response: Response,
): Response {
  const location = response.headers.get("location");
  if (!location || !options.microsoftProof) return response;
  const target = options.microsoftProof.resolveInternalReturn(request.headers, location);
  if (!target) return response;
  const headers = new Headers(response.headers);
  headers.set("location", target.toString());
  return new Response(response.body, { status: response.status, headers });
}

function resolveProviderRedirect(
  options: CreateAuthRequestHandlerOptions,
  input: {
    request: Request;
    providerId: string | null;
    response: Response;
  },
): Response {
  const { request, providerId, response } = input;
  return providerId === "microsoft" ? rewriteMicrosoftReturn(options, request, response) : response;
}

async function runCapturedHandler(
  options: CreateAuthRequestHandlerOptions,
  context: {
    request: Request;
    callbackProviderId: string | null;
    capture: { error: unknown };
    resetCapture: { sessionHandles: readonly string[] };
    microsoftCapture: {
      request: Request;
      proofId: string | null;
      bootstrapClaimToken: string | null;
      pending: boolean;
    };
  },
): Promise<Response> {
  const { request, callbackProviderId, capture, resetCapture, microsoftCapture } = context;
  try {
    return await authHandlerErrorCapture.run(capture, () =>
      passwordResetSessionCapture.run(resetCapture, () =>
        callbackProviderId === "microsoft" && options.microsoftProof
          ? microsoftCallbackCapture.run(microsoftCapture, () => options.rawHandler(request))
          : options.rawHandler(request),
      ),
    );
  } finally {
    if (microsoftCapture.bootstrapClaimToken)
      options.microsoftProof?.releaseBootstrapClaim(microsoftCapture.bootstrapClaimToken);
  }
}

function callbackFailureTarget(
  options: CreateAuthRequestHandlerOptions,
  request: Request,
  callbackProviderId: string | null,
): URL | null {
  return callbackProviderId ? options.callbackErrorUrl(request) : null;
}

function microsoftErrorRedirect(
  options: CreateAuthRequestHandlerOptions,
  context: { request: Request; providerId: string | null; error: unknown },
): Response | null {
  const { request, providerId, error } = context;
  if (providerId !== "microsoft" || !(error instanceof MicrosoftProofError)) return null;
  const target =
    options.microsoftProof?.errorReturnUrl(request.headers, error.code) ?? new URL(options.browserAuthErrorUrl);
  return redirectWithError(target, error.code);
}

async function runAuthenticatedRequest(
  options: CreateAuthRequestHandlerOptions,
  context: {
    request: Request;
    requestUrl: URL;
    callbackProviderId: string | null;
    failureTarget: URL | null;
  },
): Promise<Response> {
  const { request, requestUrl, callbackProviderId, failureTarget } = context;
  try {
    const capture: { error: unknown } = { error: null };
    const resetCapture: { sessionHandles: readonly string[] } = { sessionHandles: [] };
    const microsoftCapture = {
      request,
      proofId: null as string | null,
      bootstrapClaimToken: null as string | null,
      pending: false,
    };
    const response = await runCapturedHandler(options, {
      request,
      callbackProviderId,
      capture,
      resetCapture,
      microsoftCapture,
    });
    if (microsoftCapture.pending) {
      return Response.redirect(new URL("/verify-microsoft?state=check-email", requestUrl.origin), 302);
    }
    const microsoftFailure = microsoftErrorRedirect(options, {
      request,
      providerId: callbackProviderId,
      error: capture.error,
    });
    if (microsoftFailure) return microsoftFailure;
    if (response.ok && resetCapture.sessionHandles.length > 0) {
      options.commitResetSessions(resetCapture.sessionHandles);
    }
    const errorRedirect = redirectCapturedCallbackError({
      callbackProviderId,
      capturedError: capture.error,
      failureTarget,
      browserAuthErrorUrl: options.browserAuthErrorUrl,
    });
    if (errorRedirect)
      return resolveProviderRedirect(options, { request, providerId: callbackProviderId, response: errorRedirect });
    reconcileCallback(options, callbackProviderId);
    return resolveProviderRedirect(options, { request, providerId: callbackProviderId, response });
  } catch (error) {
    const microsoftFailure = microsoftErrorRedirect(options, { request, providerId: callbackProviderId, error });
    if (microsoftFailure) return microsoftFailure;
    if (!isFederatedAccountCoordinateConstraint(error)) throw error;
    const redirect = redirectWithError(
      failureTarget ?? new URL(options.browserAuthErrorUrl),
      "account_already_linked_to_different_user",
    );
    return resolveProviderRedirect(options, { request, providerId: callbackProviderId, response: redirect });
  }
}

// Owns provider callback HTTP behavior; persistence and identity state stay with the adapter.
export function createAuthRequestHandler(options: CreateAuthRequestHandlerOptions): Auth["handler"] {
  return async (request) => {
    // Enforce inactivity even when a caller goes directly to an authenticated Better Auth route
    // such as change-password rather than first touching an application data route.
    const requestUrl = new URL(request.url);
    const callbackPath = requestUrl.pathname.replace(/^\/api\/auth/, "");
    const callbackProviderId = options.providerIdFromExternalContext({ path: callbackPath });
    const failureTarget = callbackFailureTarget(options, request, callbackProviderId);
    if (callbackProviderId === "microsoft" && options.microsoftProof) {
      const preflight = preflightMicrosoftCallback(options, request, failureTarget);
      if (preflight) return preflight;
    }
    return runAuthenticatedRequest(options, { request, requestUrl, callbackProviderId, failureTarget });
  };
}
