import type { Db } from "../db";
import type * as AuthFacade from "../auth";
import type { Auth } from "./authTypes";
import { createMicrosoftProof, MicrosoftProofError } from "./microsoftProof";
import { resolveMicrosoftTenantId } from "./socialProviders";

type Input = {
  db: Db;
  environment: Record<string, string | undefined>;
  secret: string;
  publicUrl: URL;
  applicationId: string;
  trustedOrigins: readonly string[];
  AuthConfigError: typeof AuthFacade.AuthConfigError;
  getAuth: () => Auth | null;
};

export function createConfiguredMicrosoftProof(input: Input) {
  if (
    !input.environment.SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID ||
    !input.environment.SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET
  )
    return null;
  const currentAuth = () => {
    const auth = input.getAuth();
    if (!auth) throw new MicrosoftProofError("MICROSOFT_PROVIDER_UNAVAILABLE", 503);
    return auth;
  };
  return createMicrosoftProof({
    db: input.db,
    environment: input.environment,
    secret: input.secret,
    publicUrl: input.publicUrl,
    applicationId: input.applicationId,
    tenantId: resolveMicrosoftTenantId(input.environment.SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID, input.AuthConfigError),
    trustedOrigins: input.trustedOrigins,
    getSession: (headers) => currentAuth().api.getSession({ headers }),
    oauthStart: async (headers, intent) => {
      const requestHeaders = new Headers(headers);
      requestHeaders.set("content-type", "application/json");
      const response = await currentAuth().handler(
        new Request(
          new URL(intent.purpose === "link" ? "/api/auth/link-social" : "/api/auth/sign-in/social", input.publicUrl),
          {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify({
              provider: "microsoft",
              callbackURL: intent.callbackUrl,
              errorCallbackURL: intent.errorCallbackUrl,
            }),
          },
        ),
      );
      const body: unknown = await response.json().catch(() => null);
      const url = body && typeof body === "object" && "url" in body ? body.url : null;
      if (!response.ok || typeof url !== "string") throw new MicrosoftProofError("MICROSOFT_PROVIDER_UNAVAILABLE", 503);
      return { url, setCookies: response.headers.getSetCookie() };
    },
  });
}
