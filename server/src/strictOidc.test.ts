import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import {
  createStrictOidcClient,
  StrictOidcProviderUnavailableError,
  StrictOidcVerificationError,
  strictOidcUserInfo,
} from "./strictOidc";

// Off-issuer endpoint containment resolves hostnames through DNS; the loopback issuer used across
// this suite keeps every other endpoint same-origin, so `lookup` is only reached by the split-origin
// tests below, which drive it explicitly. A default rejection makes any unexpected call a hard error.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => Promise.reject(new Error("unexpected DNS lookup"))) }));

const issuer = "http://127.0.0.1:5556/dex";
const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
const clientId = "capacitylens-test";
const jwksUrl = `${issuer}/keys`;
const userInfoUrl = `${issuer}/userinfo`;
const requiredDiscoveryCapabilities = {
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
} as const;

interface SigningKey {
  kid: string;
  privateKey: Parameters<SignJWT["sign"]>[0];
  publicJwk: Record<string, unknown>;
}

async function signingKey(kid: string): Promise<SigningKey> {
  const pair = await generateKeyPair("RS256");
  return {
    kid,
    privateKey: pair.privateKey,
    publicJwk: {
      ...(await exportJWK(pair.publicKey)),
      kid,
      use: "sig",
      alg: "RS256",
    },
  };
}

async function idToken(
  key: SigningKey,
  overrides: {
    issuer?: string;
    audience?: string | string[];
    subject?: string;
    azp?: unknown;
    issuedAt?: number;
    expiration?: number;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: "owner@example.com",
    email_verified: true,
    ...(overrides.azp === undefined ? {} : { azp: overrides.azp }),
  })
    .setProtectedHeader({ alg: "RS256", kid: key.kid, typ: "JWT" })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? clientId)
    .setSubject(overrides.subject ?? "subject-1")
    .setIssuedAt(overrides.issuedAt ?? now)
    .setExpirationTime(overrides.expiration ?? now + 300)
    .sign(key.privateKey);
}

describe("strictOidcUserInfo", () => {
  let currentKeys: SigningKey[];
  let userInfo: Record<string, unknown>;

  beforeEach(async () => {
    currentKeys = [await signingKey("key-1")];
    userInfo = {
      sub: "subject-1",
      email: "owner@example.com",
      email_verified: true,
      name: "Owner",
      picture: "https://images.example.test/owner.png",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === discoveryUrl) {
          return Response.json({
            ...requiredDiscoveryCapabilities,
            issuer,
            authorization_endpoint: `${issuer}/auth`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: jwksUrl,
            userinfo_endpoint: userInfoUrl,
            id_token_signing_alg_values_supported: ["RS256"],
          });
        }
        if (url === jwksUrl) {
          expect(init?.redirect).toBe("error");
          expect(init?.signal).toBeInstanceOf(AbortSignal);
          return Response.json({
            keys: currentKeys.map((key) => key.publicJwk),
          });
        }
        if (url === userInfoUrl) {
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
          return Response.json(userInfo);
        }
        return new Response(null, { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("verifies the signed ID token and maps a subject-bound verified profile", async () => {
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    const profile = await resolve({
      idToken: await idToken(currentKeys[0]),
      accessToken: "access-token",
    });

    expect(profile).toMatchObject({
      id: "subject-1",
      sub: "subject-1",
      email: "owner@example.com",
      emailVerified: true,
      name: "Owner",
      image: "https://images.example.test/owner.png",
    });
  });

  it("preserves a missing or false email verification claim for the stateful admission boundary", async () => {
    delete userInfo.email_verified;
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).resolves.toMatchObject({ emailVerified: false });
    userInfo.email_verified = false;
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).resolves.toMatchObject({ emailVerified: false });
  });

  it("normalizes a valid email and rejects malformed identity attributes", async () => {
    userInfo.email = " OWNER@Example.com ";
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).resolves.toMatchObject({ email: "owner@example.com" });

    userInfo.email = "not-an-email";
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).rejects.toThrow("invalid email");
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).rejects.toBeInstanceOf(StrictOidcVerificationError);
  });

  it.each([
    ["issuer", { issuer: "http://127.0.0.1:5556/other" }, /unexpected "iss" claim value/],
    ["audience", { audience: "other-client" }, /unexpected "aud" claim value/],
  ])("rejects an ID token with the wrong %s", async (_label, overrides, message) => {
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0], overrides),
        accessToken: "access-token",
      }),
    ).rejects.toThrow(message);
  });

  it("rejects an ID token signed by an untrusted key", async () => {
    const attacker = await signingKey("attacker");
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(attacker),
        accessToken: "access-token",
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "ERR_JWKS_NO_MATCHING_KEY" }),
    });
  });

  it("rejects stale and implausibly future-issued ID tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0], {
          issuedAt: now - 3600,
          expiration: now + 300,
        }),
        accessToken: "access-token",
      }),
    ).rejects.toThrow(/"iat" claim timestamp check failed/);
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0], {
          issuedAt: now + 300,
          expiration: now + 600,
        }),
        accessToken: "access-token",
      }),
    ).rejects.toThrow(/"iat" claim timestamp check failed/);
  });

  it("drops unsafe profile image URLs and rejects an oversized display name", async () => {
    userInfo.picture = "javascript:alert(1)";
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).resolves.toMatchObject({ image: undefined });
    userInfo.name = "x".repeat(10_000);
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).rejects.toThrow("missing or invalid name");
  });

  it.each(["http://images.example.test/owner.png", `https://images.example.test/${"x".repeat(2049)}`])(
    "drops a profile image outside the HTTPS and length policy: %s",
    async (picture) => {
      userInfo.picture = picture;
      const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
      await expect(
        resolve({
          idToken: await idToken(currentKeys[0]),
          accessToken: "access-token",
        }),
      ).resolves.toMatchObject({ image: undefined });
    },
  );

  it("rejects a user-info response for a different subject", async () => {
    userInfo.sub = "subject-2";
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).rejects.toThrow("subjects do not match");
  });

  it("requires this client as authorized party for multi-audience tokens", async () => {
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0], {
          audience: [clientId, "another-client"],
        }),
        accessToken: "access-token",
      }),
    ).rejects.toThrow("authorized party");
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0], {
          audience: [clientId, "another-client"],
          azp: clientId,
        }),
        accessToken: "access-token",
      }),
    ).resolves.toMatchObject({ id: "subject-1" });
  });

  it("rejects a mismatched authorized party even with one valid audience", async () => {
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0], { azp: "another-client" }),
        accessToken: "access-token",
      }),
    ).rejects.toThrow("authorized party");
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0], { azp: 42 }),
        accessToken: "access-token",
      }),
    ).rejects.toThrow("must be a string");
  });

  it("refreshes JWKS immediately when the IdP rotates to an unknown key id", async () => {
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).resolves.toMatchObject({ id: "subject-1" });

    currentKeys = [await signingKey("key-2")];
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).resolves.toMatchObject({ id: "subject-1" });
  });

  it("rejects discovery metadata that cannot support the strict signing profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...requiredDiscoveryCapabilities,
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ["HS256"],
        }),
      ),
    );
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).rejects.toThrow("no accepted asymmetric");
  });

  it("pins discovery metadata to the configured issuer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...requiredDiscoveryCapabilities,
          issuer: "https://different-idp.example.test",
        }),
      ),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).rejects.toThrow("OIDC discovery issuer does not match the configured issuer.");
  });

  const discoveryWith = (override: Record<string, unknown>) =>
    vi.fn(async () =>
      Response.json({
        ...requiredDiscoveryCapabilities,
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: jwksUrl,
        userinfo_endpoint: userInfoUrl,
        id_token_signing_alg_values_supported: ["RS256"],
        ...override,
      }),
    );

  // SSRF containment only engages for a publicly-reachable issuer, so these tests configure one (a
  // literal public IP keeps `issuerIsInternal` from needing a DNS lookup). Endpoints default to the
  // issuer origin; each case overrides one to an off-origin address that must be refused or allowed.
  const publicIssuer = "https://93.184.216.34";
  const publicDiscoveryUrl = `${publicIssuer}/.well-known/openid-configuration`;
  const publicDiscoveryWith = (override: Record<string, unknown>) =>
    vi.fn(async () =>
      Response.json({
        ...requiredDiscoveryCapabilities,
        issuer: publicIssuer,
        authorization_endpoint: `${publicIssuer}/auth`,
        token_endpoint: `${publicIssuer}/token`,
        jwks_uri: `${publicIssuer}/keys`,
        userinfo_endpoint: `${publicIssuer}/userinfo`,
        id_token_signing_alg_values_supported: ["RS256"],
        ...override,
      }),
    );
  const publicClient = () =>
    createStrictOidcClient({ issuer: publicIssuer, clientId, discoveryUrl: publicDiscoveryUrl });

  it.each([
    ["token_endpoint literal loopback", { token_endpoint: "https://127.0.0.1:9999/token" }],
    ["jwks_uri literal RFC1918", { jwks_uri: "https://10.0.0.5/keys" }],
    ["userinfo_endpoint literal link-local metadata", { userinfo_endpoint: "https://169.254.169.254/userinfo" }],
    ["jwks_uri literal IPv6 loopback", { jwks_uri: "https://[::1]/keys" }],
    // IPv6 forms that embed an IPv4 address must classify by the embedded v4, whatever the spelling.
    ["jwks_uri IPv4-mapped loopback (hex)", { jwks_uri: "https://[::ffff:7f00:1]/keys" }],
    ["jwks_uri IPv4-mapped loopback (dotted)", { jwks_uri: "https://[::ffff:127.0.0.1]/keys" }],
    ["jwks_uri IPv4-mapped metadata (hex)", { jwks_uri: "https://[::ffff:a9fe:a9fe]/keys" }],
    ["jwks_uri IPv4-compatible loopback", { jwks_uri: "https://[::7f00:1]/keys" }],
    ["jwks_uri 6to4 loopback", { jwks_uri: "https://[2002:7f00:1::]/keys" }],
    ["jwks_uri NAT64 RFC1918", { jwks_uri: "https://[64:ff9b::a00:5]/keys" }],
  ])("refuses an off-issuer %s that is a private or reserved address", async (_label, override) => {
    vi.stubGlobal("fetch", publicDiscoveryWith(override));
    await expect(publicClient().metadata()).rejects.toThrow("private or reserved network address");
  });

  it("refuses an off-issuer endpoint whose hostname resolves to a private address", async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }] as unknown as LookupAddress);
    vi.stubGlobal("fetch", publicDiscoveryWith({ jwks_uri: "https://keys.internal.example/keys" }));
    await expect(publicClient().metadata()).rejects.toThrow("private or reserved network address");
  });

  it("accepts an off-issuer endpoint that resolves to a globally routable address (split-origin providers)", async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "198.51.100.7", family: 4 }] as unknown as LookupAddress);
    vi.stubGlobal("fetch", publicDiscoveryWith({ jwks_uri: "https://keys.provider.example/oauth2/v3/certs" }));
    await expect(publicClient().metadata()).resolves.toMatchObject({
      jwks_uri: "https://keys.provider.example/oauth2/v3/certs",
    });
  });

  it("accepts an off-issuer endpoint on a global-unicast IPv6 literal", async () => {
    vi.stubGlobal("fetch", publicDiscoveryWith({ jwks_uri: "https://[2606:4700:4700::1111]/keys" }));
    await expect(publicClient().metadata()).resolves.toMatchObject({ jwks_uri: "https://[2606:4700:4700::1111]/keys" });
  });

  it("accepts an off-issuer private endpoint when the issuer itself is internal (split-origin on-prem)", async () => {
    // Loopback issuer => intentionally internal deployment => containment is skipped, so an internal
    // jwks host on a different origin is allowed with no operator configuration.
    vi.stubGlobal("fetch", discoveryWith({ jwks_uri: "https://10.0.0.5/keys" }));
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).resolves.toMatchObject({ jwks_uri: "https://10.0.0.5/keys" });
  });

  it.each([null, []])("rejects a non-object discovery document (%j)", async (document) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(document)),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).rejects.toThrow("OIDC discovery returned a non-object document.");
  });

  it.each([
    [
      "authorization-code response type",
      {
        response_types_supported: ["id_token"],
        subject_types_supported: ["public"],
      },
      "authorization-code response type",
    ],
    [
      "standard subject type",
      {
        response_types_supported: ["code"],
        subject_types_supported: ["nonstandard"],
      },
      "subject type",
    ],
  ])("rejects discovery without a supported %s", async (_label, capabilities, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ["RS256"],
          ...capabilities,
        }),
      ),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).rejects.toThrow(message);
  });

  it("selects only standard confidential-client token authentication methods", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...requiredDiscoveryCapabilities,
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        }),
      ),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).resolves.toMatchObject({
      token_endpoint_authentication: "post",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...requiredDiscoveryCapabilities,
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["private_key_jwt"],
        }),
      ),
    );
    const unsupported = createStrictOidcClient({
      issuer,
      clientId,
      discoveryUrl,
    });
    await expect(unsupported.metadata()).rejects.toThrow("no supported confidential-client");
  });

  it("exchanges the code only at the validated endpoint with bounded no-redirect fetch policy", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === discoveryUrl) {
        return Response.json({
          ...requiredDiscoveryCapabilities,
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
        });
      }
      if (url === `${issuer}/token`) {
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("error");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(new Headers(init?.headers).get("authorization")).toMatch(/^Basic /);
        expect(init?.body).toBeInstanceOf(URLSearchParams);
        expect((init?.body as URLSearchParams).get("code_verifier")).toBe("verifier");
        return Response.json({
          access_token: "access-token",
          id_token: "id-token",
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createStrictOidcClient({
      issuer,
      clientId,
      clientSecret: "client-secret",
      discoveryUrl,
    });

    await expect(
      client.exchangeCode({
        code: "authorization-code",
        redirectURI: "https://app.example.test/api/auth/oauth2/callback/sso",
        codeVerifier: "verifier",
      }),
    ).resolves.toMatchObject({
      accessToken: "access-token",
      idToken: "id-token",
    });
  });

  it("refuses code exchange before discovery when no client secret is configured", async () => {
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(
      client.exchangeCode({
        code: "authorization-code",
        redirectURI: "https://app.example.test/api/auth/oauth2/callback/sso",
      }),
    ).rejects.toThrow("requires a client secret");
  });

  it("rejects a non-object token response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === discoveryUrl) {
          return Response.json({
            ...requiredDiscoveryCapabilities,
            issuer,
            authorization_endpoint: `${issuer}/auth`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: jwksUrl,
            userinfo_endpoint: userInfoUrl,
            id_token_signing_alg_values_supported: ["RS256"],
          });
        }
        if (url === `${issuer}/token`) return Response.json([]);
        return new Response(null, { status: 404 });
      }),
    );
    const client = createStrictOidcClient({
      issuer,
      clientId,
      clientSecret: "client-secret",
      discoveryUrl,
    });
    await expect(
      client.exchangeCode({
        code: "authorization-code",
        redirectURI: "https://app.example.test/api/auth/oauth2/callback/sso",
      }),
    ).rejects.toThrow("token endpoint returned a non-object document");
  });

  it.each([
    [new Response("not json", { headers: { "content-type": "text/html" } }), "JSON media type"],
    [new Response(null, { headers: { "content-type": "application/json" } }), "empty response"],
  ])("rejects an invalid provider response before decoding: %s", async (response, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).rejects.toThrow(message);
  });

  it("enforces the streamed JSON size cap when content-length is absent", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).rejects.toThrow("size limit");
  });

  it("cancels declared-oversized provider JSON before rejecting it", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            headers: {
              "content-type": "application/json",
              "content-length": String(1024 * 1024 + 1),
            },
          }),
      ),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).rejects.toThrow("size limit");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels a non-JSON provider body while preserving the media-type error if cancellation fails", async () => {
    const cancel = vi.fn(() => {
      throw new Error("cancel failed");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { "content-type": "text/html" } }),
      ),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).rejects.toThrow("JSON media type");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects malformed provider JSON and retries discovery on the next attempt", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("{malformed", {
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json({
          ...requiredDiscoveryCapabilities,
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        });
      }),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).rejects.toThrow("malformed JSON");
    await expect(client.metadata()).resolves.toMatchObject({ issuer });
    expect(attempts).toBe(2);
  });

  it("revalidates discovery metadata after the bounded cache lifetime", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        return Response.json({
          ...requiredDiscoveryCapabilities,
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        });
      }),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });

    await client.metadata();
    now += 4 * 60 * 1_000;
    await client.metadata();
    expect(attempts).toBe(1);
    now += 2 * 60 * 1_000;
    await client.metadata();
    expect(attempts).toBe(2);
  });

  it("rejects unsafe discovered endpoints before redirect or token exchange can use them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...requiredDiscoveryCapabilities,
          issuer,
          authorization_endpoint: "http://idp.example.test/authorize",
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).rejects.toThrow("authorization_endpoint must use HTTPS");
  });

  it.each([
    [42, "missing authorization_endpoint"],
    ["not a URL", "invalid authorization_endpoint"],
    [`http://user:pass@127.0.0.1:5556/auth`, "must not contain credentials"],
  ])("rejects malformed discovered authorization endpoints: %j", async (endpoint, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...requiredDiscoveryCapabilities,
          issuer,
          authorization_endpoint: endpoint,
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).rejects.toThrow(message);
  });

  it("rejects discovered endpoint fragments rather than silently dropping them on HTTP use", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...requiredDiscoveryCapabilities,
          issuer,
          authorization_endpoint: `${issuer}/auth#unexpected`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
    );
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl });
    await expect(client.metadata()).rejects.toThrow("must not contain a fragment");
  });

  it("fails closed when discovery is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).rejects.toThrow("HTTP 503");
    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).rejects.toBeInstanceOf(StrictOidcProviderUnavailableError);
  });

  it("keeps a transient user-info outage distinct from an identity verification failure", async () => {
    const healthyFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === userInfoUrl) return new Response(null, { status: 503 });
        return healthyFetch(input, init);
      }),
    );
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });

    await expect(
      resolve({
        idToken: await idToken(currentKeys[0]),
        accessToken: "access-token",
      }),
    ).rejects.toBeInstanceOf(StrictOidcProviderUnavailableError);
  });

  it("retries discovery after a transient failure instead of caching rejection forever", async () => {
    const healthyFetch = globalThis.fetch;
    let discoveryAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === discoveryUrl && discoveryAttempts++ === 0) {
          return new Response(null, { status: 503 });
        }
        return healthyFetch(input, init);
      }),
    );
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl });
    const tokens = {
      idToken: await idToken(currentKeys[0]),
      accessToken: "access-token",
    };

    await expect(resolve(tokens)).rejects.toThrow("HTTP 503");
    await expect(resolve(tokens)).resolves.toMatchObject({ id: "subject-1" });
    expect(discoveryAttempts).toBe(2);
  });
});
