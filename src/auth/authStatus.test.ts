import { describe, expect, it } from "vitest";
import { parseAuthProviders } from "./authStatus";

describe("parseAuthProviders", () => {
  it.each([undefined, "unrecognised"])("keeps a provider with %s brand metadata as generic", (brand) => {
    expect(
      parseAuthProviders([
        {
          id: "sso",
          label: "Google",
          kind: "oidc",
          experimental: false,
          ...(brand === undefined ? {} : { brand }),
        },
      ]),
    ).toEqual([{ id: "sso", label: "Google", kind: "oidc", experimental: false, brand: "generic" }]);
  });

  it("keeps an explicit Google brand on a strict OIDC provider", () => {
    expect(
      parseAuthProviders([{ id: "sso", label: "Google", kind: "oidc", brand: "google", experimental: false }]),
    ).toEqual([{ id: "sso", label: "Google", kind: "oidc", brand: "google", experimental: false }]);
  });

  it("brands a social provider from its id, not from the payload", () => {
    expect(
      parseAuthProviders([
        { id: "microsoft", label: "Microsoft", kind: "social", brand: "google", experimental: true },
      ]),
    ).toEqual([{ id: "microsoft", label: "Microsoft", kind: "social", brand: "microsoft", experimental: true }]);
  });

  it("preserves Google social presentation from an older server without brand metadata", () => {
    expect(parseAuthProviders([{ id: "google", label: "Google", kind: "social", experimental: true }])).toEqual([
      { id: "google", label: "Google", kind: "social", experimental: true, brand: "google" },
    ]);
  });
});
