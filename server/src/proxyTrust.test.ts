import { describe, expect, it } from "vitest";
import { canTrustProxyHeaders } from "./proxyTrust";

describe("proxy-header trust posture", () => {
  it.each(["127.0.0.1", "localhost", "::1"])("trusts the local proxy hop on %s", (host) => {
    expect(canTrustProxyHeaders({}, host)).toBe(true);
  });

  it("requires the explicit opt-in on a directly exposed host", () => {
    expect(canTrustProxyHeaders({}, "0.0.0.0")).toBe(false);
    expect(canTrustProxyHeaders({ CAPACITYLENS_TRUST_PROXY_HEADERS: "1" }, "0.0.0.0")).toBe(true);
    expect(canTrustProxyHeaders({ CAPACITYLENS_TRUST_PROXY_HEADERS: "0" }, "0.0.0.0")).toBe(false);
  });
});
