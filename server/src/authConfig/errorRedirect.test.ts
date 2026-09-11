import { describe, expect, it, vi } from "vitest";

import { createErrorRedirect } from "./errorRedirect";

const fallbackUrl = new URL("https://app.example.test/auth/error");
const trustedOrigin = "https://trusted.example.test";
// SHA-256("opaque") encoded as base64url, fixed independently of the production implementation.
const opaqueStateIdentifier = "bSKYhMEmi7CrMtjaMV0P5S-RRyKL2DCje8n7KKlUlA0";

function createRedirect(values: readonly string[] | null = null) {
  const readVerificationValues = vi.fn<(storedIdentifier: string) => readonly string[] | null>(() => values);
  const redirect = createErrorRedirect({
    browserAuthErrorUrl: fallbackUrl,
    trustedLinkOrigins: new Set([trustedOrigin]),
    readVerificationValues,
  });

  return { readVerificationValues, redirect };
}

function callbackRequest(state?: string) {
  const url = new URL("https://server.example.test/api/auth/callback");
  if (state !== undefined) url.searchParams.set("state", state);
  return new Request(url);
}

describe("createErrorRedirect", () => {
  it("returns fresh fallback URLs without reading storage for missing or empty state", () => {
    const { readVerificationValues, redirect } = createRedirect();
    const missingState = redirect(callbackRequest());
    const emptyState = redirect(callbackRequest(""));

    expect(missingState).toEqual(fallbackUrl);
    expect(emptyState).toEqual(fallbackUrl);
    expect(missingState).not.toBe(fallbackUrl);
    expect(emptyState).not.toBe(fallbackUrl);
    expect(missingState).not.toBe(emptyState);
    expect(readVerificationValues).not.toHaveBeenCalled();
  });

  it("uses the indexed SHA-256 identifier for a callback state", () => {
    const { readVerificationValues, redirect } = createRedirect();
    expect(redirect(callbackRequest("opaque"))).toEqual(fallbackUrl);
    expect(readVerificationValues).toHaveBeenCalledWith(opaqueStateIdentifier);
  });
});

describe("createErrorRedirect validation", () => {
  it.each([
    ["a null storage result", null],
    ["an empty storage result", []],
    ["an empty row", [""]],
    ["malformed JSON", ["{"]],
    ["JSON null", ["null"]],
    ["a different state", [JSON.stringify({ oauthState: "another-state", errorURL: `${trustedOrigin}/error` })]],
    ["a missing error URL", [JSON.stringify({ oauthState: "opaque" })]],
    ["a non-string error URL", [JSON.stringify({ oauthState: "opaque", errorURL: 42 })]],
    ["a relative error URL", [JSON.stringify({ oauthState: "opaque", errorURL: "/error" })]],
    ["a malformed absolute error URL", [JSON.stringify({ oauthState: "opaque", errorURL: "https://[invalid" })]],
    [
      "an untrusted error URL",
      [JSON.stringify({ oauthState: "opaque", errorURL: "https://untrusted.example.test/error" })],
    ],
  ] as const)("falls back for %s", (_reason, values) => {
    const { readVerificationValues, redirect } = createRedirect(values);

    expect(redirect(callbackRequest("opaque"))).toEqual(fallbackUrl);
    expect(readVerificationValues).toHaveBeenCalledWith(opaqueStateIdentifier);
  });

  it.each([
    "https://user@trusted.example.test/error",
    "https://user:secret@trusted.example.test/error",
    "https://:secret@trusted.example.test/error",
  ])("rejects a trusted URL containing credentials", (errorURL) => {
    const { readVerificationValues, redirect } = createRedirect([JSON.stringify({ oauthState: "opaque", errorURL })]);

    expect(redirect(callbackRequest("opaque"))).toEqual(fallbackUrl);
    expect(readVerificationValues).toHaveBeenCalledWith(opaqueStateIdentifier);
  });

  it("selects a later matching trusted URL after an invalid row", () => {
    const target = new URL(`${trustedOrigin}/retry?reason=provider_denied`);
    const { readVerificationValues, redirect } = createRedirect([
      "not-json",
      JSON.stringify({ oauthState: "opaque", errorURL: target.toString() }),
    ]);

    expect(redirect(callbackRequest("opaque"))).toEqual(target);
    expect(readVerificationValues).toHaveBeenCalledWith(opaqueStateIdentifier);
  });
});

describe("createErrorRedirect storage errors", () => {
  it("surfaces a storage failure", () => {
    const failure = new Error("verification table unavailable");
    const readVerificationValues = vi.fn<(storedIdentifier: string) => readonly string[] | null>(() => {
      throw failure;
    });
    const redirect = createErrorRedirect({
      browserAuthErrorUrl: fallbackUrl,
      trustedLinkOrigins: new Set([trustedOrigin]),
      readVerificationValues,
    });

    expect(() => redirect(callbackRequest("opaque"))).toThrow(failure);
    expect(readVerificationValues).toHaveBeenCalledWith(opaqueStateIdentifier);
  });
});
