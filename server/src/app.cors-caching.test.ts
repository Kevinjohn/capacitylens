import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { openDb } from "./db";
import { freshApp } from "./fixtures/appTestEntities";
import { call } from "./fixtures/appTestHttp";

function createCorsOriginConfigurationTests() {
  it("defaults FAIL-CLOSED to the localhost allow-list (not a wildcard)", async () => {
    const { app } = freshApp();
    // A local dev origin is reflected (it's on the default allow-list)…
    const local = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(local.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    // …but an arbitrary site gets NO ACAO header (the browser blocks it) — the factory
    // never opens to '*' unless explicitly told to.
    const evil = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://evil.test" },
    });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects '*' because credentialed CORS requires explicit origins", () => {
    expect(() => createApp(openDb(":memory:"), { corsOrigin: "*" })).toThrow(/explicit/i);
  });

  it("normalizes harmless origin spellings and rejects non-origin URLs at startup", async () => {
    const app = createApp(openDb(":memory:"), {
      corsOrigin: "HTTPS://APP.EXAMPLE.COM:443/,http://localhost:80",
    });

    const canonicalHttps = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://app.example.com" },
    });
    expect(canonicalHttps.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    const canonicalHttp = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost" },
    });
    expect(canonicalHttp.headers["access-control-allow-origin"]).toBe("http://localhost");

    for (const corsOrigin of [
      "not an origin",
      "ftp://app.example.com",
      "https://user@app.example.com",
      "https://app.example.com/path",
      "https://app.example.com?query=1",
      "https://app.example.com#fragment",
    ]) {
      expect(() => createApp(openDb(":memory:"), { corsOrigin })).toThrow(/bare HTTP\(S\) origin/i);
    }
  });
}

function createCorsReflectionTests() {
  it("reflects an allowed origin and omits the header for a disallowed one", async () => {
    const app = createApp(openDb(":memory:"), {
      corsOrigin: "http://good.test,http://also.test",
    });
    const ok = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://good.test" },
    });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://good.test");
    const bad = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://evil.test" },
    });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
}

function createCorsCredentialAndRequestGateTests() {
  it("pairs Allow-Credentials with every reflected explicit origin (P3.4)", async () => {
    // The client sends credentials: 'include' on every request; a credentialed
    // cross-origin response without this header is refused by the browser.
    const { app } = freshApp();
    const reflected = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(reflected.headers["access-control-allow-credentials"]).toBe("true");
    const disallowed = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://evil.test" },
    });
    expect(disallowed.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("answers a write preflight with 204 + CORS headers (no OPTIONS route exists)", async () => {
    // Regression guard: every cross-origin write (JSON POST/PUT/PATCH/DELETE) is
    // preflighted by the browser, and OPTIONS matches no route — the 204 comes from the
    // ROOT-level onRequest hook on the not-found path. When the hook briefly moved into
    // the routes child plugin, preflights became bare 404s without CORS headers and the
    // db-backed e2e app could no longer save anything.
    const { app } = freshApp();
    const res = await call(app, {
      method: "OPTIONS",
      url: "/api/batch",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("rejects unsafe browser requests from a disallowed Origin before the handler runs", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: { origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Cross-site request rejected." });
  });

  it("rejects cross-site Fetch Metadata even when Origin is absent", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.statusCode).toBe(403);
  });
}

function createCorsSameOriginTests() {
  it("keeps non-browser clients and allowed same-origin writes working", async () => {
    const { app } = freshApp();
    expect((await call(app, { method: "POST", url: "/api/test/reset" })).statusCode).toBe(200);
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/test/reset",
          headers: {
            origin: "http://localhost:5173",
            "sec-fetch-site": "same-site",
          },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("accepts the packaged same-origin proxy path without requiring a redundant CORS allow-list", async () => {
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
      trustProxyHeaders: true,
    });
    const response = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com",
        origin: "https://capacity.example.com",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://capacity.example.com");
  });

  it("falls back to exact trusted-proxy scheme and Host comparison without Fetch Metadata", async () => {
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
      trustProxyHeaders: true,
    });
    const response = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com:8443",
        origin: "https://capacity.example.com:8443",
        "x-forwarded-proto": "https",
      },
    });
    expect(response.statusCode).toBe(200);
  });
}

function createCorsCrossSiteAndTlsTests() {
  it("lets a cross-site write through when its Origin is on the credentialed allow-list (Fetch Metadata notwithstanding)", async () => {
    // FIX: an Origin EXACTLY on the CORS allow-list is the operator's explicit cross-site contract,
    // so it must pass the gate even when the browser labels the request Sec-Fetch-Site: cross-site
    // (the legitimate configured cross-origin call). The old gate 403'd it on the fetchSite clause
    // despite the allow-list match; now the allow-listed Origin is reflected and the write proceeds.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "https://app.example.com",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        origin: "https://app.example.com",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
  });

  it("still 403s a genuinely cross-site write from a NON-listed Origin", async () => {
    // The allow-list exemption is exact-match only; an Origin that is neither allow-listed nor
    // same-origin, carrying a cross-site signal, remains a hard 403.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "https://app.example.com",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Cross-site request rejected." });
  });
}

function createCorsTlsTerminationTests() {
  it("treats a TLS-terminated https Origin as same-origin when only the scheme differs from http req.protocol", async () => {
    // FIX: with no Fetch Metadata and forwarded-proto NOT trusted, the standard TLS-termination
    // deploy has the browser-set Origin claim https:// while req.protocol sees http (cleartext hop
    // behind the proxy). When the Origin's host:port matches our Host and the ONLY difference is
    // that scheme upgrade, it is same-origin — the browser sets the Origin host, so it can't be
    // forged from another site. No allow-list entry and no trustProxyHeaders here.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com",
        origin: "https://capacity.example.com",
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("still 403s when the https Origin host does NOT match the request Host", async () => {
    // The scheme-upgrade exemption is host-pinned: a mismatched host stays a cross-site 403.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com",
        origin: "https://other.example.com",
      },
    });
    expect(res.statusCode).toBe(403);
  });
}

function createCorsMalformedHostAndHeaderTests() {
  it("returns a clean 403 (not a 500) when a broken proxy sends a malformed Host header", async () => {
    // REGRESSION: the same-origin check reconstructs `${protocol}://${host}` from the Host header, an
    // untrusted, proxy-influenced string. A broken proxy (or a forged request) can send a Host that
    // `new URL` rejects — here 'exa mple.com' (embedded space). That reconstruct MUST be guarded: an
    // unparseable Host is "cannot prove same-origin" → fail closed → clean cross-site 403. A refactor
    // once moved the reconstruct out of the try/catch, turning this into an uncaught TypeError → 500.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: { host: "exa mple.com", origin: "https://capacity.example.com" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Cross-site request rejected." });
  });

  it("returns a clean 403 for other unparseable Host shapes from a broken proxy", async () => {
    // Same total-function guarantee across the other Host shapes a broken proxy can emit: a lone '['
    // (unterminated IPv6 bracket) and a double-port 'host:port:port'. Every one fails closed to 403.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    for (const host of ["[", "capacity.example.com:8443:9000"]) {
      const res = await call(app, {
        method: "POST",
        url: "/api/test/reset",
        headers: { host, origin: "https://capacity.example.com" },
      });
      expect(res.statusCode, `host=${host}`).toBe(403);
    }
  });

  it("Allow-Headers lists JSON plus both operator-secret headers", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "OPTIONS",
      url: "/api/orgs",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "content-type, x-capacitylens-bootstrap-token, x-capacitylens-setup-token, x-capacitylens-sync-session, x-capacitylens-sync-sequence",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-headers"]).toContain("Content-Type");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-bootstrap-token");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-setup-token");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-sync-session");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-sync-sequence");
    expect(res.headers["access-control-expose-headers"]).toContain("x-capacitylens-audit-warning");
  });
}

describe("CORS allow-list", () => {
  createCorsOriginConfigurationTests();
  createCorsReflectionTests();
  createCorsCredentialAndRequestGateTests();
  createCorsSameOriginTests();
  createCorsCrossSiteAndTlsTests();
  createCorsTlsTerminationTests();
  createCorsMalformedHostAndHeaderTests();
});

describe("sensitive response caching", () => {
  it("sets no-store on health, errors, and authenticated API responses", async () => {
    const { app } = freshApp();
    for (const request of [
      { method: "GET" as const, url: "/api/health" },
      { method: "GET" as const, url: "/api/state" },
      { method: "GET" as const, url: "/api/does-not-exist" },
    ]) {
      const res = await call(app, request);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers.pragma).toBe("no-cache");
    }
  });
});
