import type { getOAuth2Tokens } from "../strictOidc";

export const ACCEPTED_SIGNING_ALGORITHMS = ["RS256", "PS256", "ES256", "EdDSA"] as const;
export const MAX_OIDC_JSON_BYTES = 1024 * 1024;

/** Configuration failure in the strict OIDC relying-party profile. Kept in this module so the
 * verifier has no runtime dependency on the Better Auth composition root. */
export class StrictOidcConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StrictOidcConfigError";
  }
}

/** A cryptographically or semantically invalid identity response. Callers may safely normalize
 * this class to a stable authentication failure without hiding provider availability incidents. */
export class StrictOidcVerificationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StrictOidcVerificationError";
  }
}

/** A bounded provider request failed because the upstream service was unavailable. */
export class StrictOidcProviderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StrictOidcProviderUnavailableError";
  }
}

export interface StrictOidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string;
  allowed_signing_algorithms: string[];
  token_endpoint_authentication: "basic" | "post";
}

export interface OidcTokens {
  accessToken?: string;
  idToken?: string;
}

export interface StrictOidcProfile extends Record<string, unknown> {
  id: string;
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string;
}

export interface StrictOidcClient {
  /** One issuer-pinned, endpoint-validated metadata view shared by redirect, exchange and claims. */
  metadata: () => Promise<StrictOidcMetadata>;
  exchangeCode: (input: {
    code: string;
    redirectURI: string;
    codeVerifier?: string;
  }) => Promise<ReturnType<typeof getOAuth2Tokens>>;
  getUserInfo: (tokens: OidcTokens) => Promise<StrictOidcProfile>;
}
