import { APIError } from "better-auth/api";
import type { Auth } from "./authTypes";
import {
  authHandlerErrorCapture,
  passwordResetSessionCapture,
  isFederatedAccountCoordinateConstraint,
} from "./captureContexts";

type StrictOidcClient = {
  metadata(): Promise<{ authorization_endpoint: string }>;
};

type CreateAuthRequestHandlerOptions = {
  rawHandler: Auth["handler"];
  providerIdFromExternalContext: (input: { path: string }) => string | null;
  callbackErrorUrl: (request: Request) => URL;
  browserAuthErrorUrl: URL;
  strictOidcClient: StrictOidcClient | null;
  strictOidcAuthorizationProxyPath: string | null;
  commitResetSessions: (sessionHandles: readonly string[]) => void;
  reconcileFederatedLinks: () => void;
};

function redirectWithError(target: URL, error: string): Response {
  target.searchParams.set("error", error);
  return Response.redirect(target, 302);
}

async function proxyStrictOidcAuthorization(options: {
  requestUrl: URL;
  strictOidcClient: StrictOidcClient;
  browserAuthErrorUrl: URL;
}): Promise<Response> {
  try {
    const metadata = await options.strictOidcClient.metadata();
    const target = new URL(metadata.authorization_endpoint);
    for (const [key, value] of options.requestUrl.searchParams) target.searchParams.append(key, value);
    return new Response(null, {
      status: 302,
      headers: { location: target.toString(), "cache-control": "no-store", pragma: "no-cache" },
    });
  } catch (error) {
    console.error("Strict OIDC authorization initialization failed.", error);
    const target = new URL(options.browserAuthErrorUrl);
    target.searchParams.set("error", "provider_unavailable");
    return new Response(null, {
      status: 302,
      headers: { location: target.toString(), "cache-control": "no-store", pragma: "no-cache" },
    });
  }
}

function isStrictOidcVerificationFailure(error: unknown): boolean {
  return error instanceof APIError && error.body?.code === "OIDC_IDENTITY_VERIFICATION_FAILED";
}

function redirectCapturedCallbackError(options: {
  callbackProviderId: string | null;
  capturedError: unknown;
  failureTarget: URL | null;
  browserAuthErrorUrl: URL;
}): Response | null {
  if (!options.callbackProviderId) return null;
  const target = options.failureTarget ?? new URL(options.browserAuthErrorUrl);
  if (isStrictOidcVerificationFailure(options.capturedError)) {
    return redirectWithError(target, "OIDC_IDENTITY_VERIFICATION_FAILED");
  }
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

// Owns provider callback/proxy HTTP behavior; persistence and identity state stay with the adapter.
export function createAuthRequestHandler(options: CreateAuthRequestHandlerOptions): Auth["handler"] {
  return async (request) => {
    // Enforce inactivity even when a caller goes directly to an authenticated Better Auth route
    // such as change-password rather than first touching an application data route.
    const requestUrl = new URL(request.url);
    const callbackPath = requestUrl.pathname.replace(/^\/api\/auth/, "");
    const callbackProviderId = options.providerIdFromExternalContext({ path: callbackPath });
    const failureTarget = callbackProviderId ? options.callbackErrorUrl(request) : null;
    if (
      options.strictOidcClient &&
      options.strictOidcAuthorizationProxyPath &&
      request.method === "GET" &&
      requestUrl.pathname === options.strictOidcAuthorizationProxyPath
    ) {
      return proxyStrictOidcAuthorization({
        requestUrl,
        strictOidcClient: options.strictOidcClient,
        browserAuthErrorUrl: options.browserAuthErrorUrl,
      });
    }
    try {
      const capture: { error: unknown } = { error: null };
      const resetCapture: { sessionHandles: readonly string[] } = { sessionHandles: [] };
      const response = await authHandlerErrorCapture.run(capture, () =>
        passwordResetSessionCapture.run(resetCapture, () => options.rawHandler(request)),
      );
      if (response.ok && resetCapture.sessionHandles.length > 0) {
        options.commitResetSessions(resetCapture.sessionHandles);
      }
      const errorRedirect = redirectCapturedCallbackError({
        callbackProviderId,
        capturedError: capture.error,
        failureTarget,
        browserAuthErrorUrl: options.browserAuthErrorUrl,
      });
      if (errorRedirect) return errorRedirect;
      reconcileCallback(options, callbackProviderId);
      return response;
    } catch (error) {
      if (!isFederatedAccountCoordinateConstraint(error)) throw error;
      return redirectWithError(
        failureTarget ?? new URL(options.browserAuthErrorUrl),
        "account_already_linked_to_different_user",
      );
    }
  };
}
