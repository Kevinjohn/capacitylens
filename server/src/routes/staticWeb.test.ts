import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { openDb } from "../db";

let webDir: string;

beforeAll(() => {
  webDir = mkdtempSync(path.join(tmpdir(), "capacitylens-web-"));
  mkdirSync(path.join(webDir, "assets"));
  writeFileSync(path.join(webDir, "index.html"), "<!doctype html><title>shell</title>");
  writeFileSync(path.join(webDir, "sw.js"), "// service worker");
  writeFileSync(path.join(webDir, "assets", "x.js"), "export const x = 1;");
});

afterAll(() => rmSync(webDir, { recursive: true, force: true }));

const serve = (options: { rateLimit?: number } = {}) => createApp(openDb(":memory:"), { webDir, ...options });

// The header set the packaged nginx edge sends (nginx-security-headers.conf), with the connect-src
// variable resolved to 'self'. Strict-Transport-Security is owned elsewhere and excluded.
function readNginxSecurityHeaders(): Map<string, string> {
  const file = fileURLToPath(new URL("../../../nginx-security-headers.conf", import.meta.url));
  const headers = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^add_header\s+(\S+)\s+(["'])(.*)\2\s+always;$/.exec(line.trim());
    if (!match?.[1] || match[3] === undefined) continue;
    if (match[1].toLowerCase() === "strict-transport-security") continue;
    headers.set(match[1].toLowerCase(), match[3].replaceAll("$capacitylens_connect_src", "'self'"));
  }
  return headers;
}

function expectWebHeaders(headers: Record<string, unknown>): void {
  const expected = readNginxSecurityHeaders();
  expect(expected.size).toBeGreaterThanOrEqual(9);
  for (const [name, value] of expected) expect(headers[name], name).toBe(value);
}

describe("static web app", () => {
  it("serves the app shell at / with no-store and the full web header set", async () => {
    const res = await serve().inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<title>shell</title>");
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-security-policy"]).toContain("connect-src 'self';");
    expectWebHeaders(res.headers);
  });

  it.each(["/schedule/week/2026-10-05", "/invite/abc", "/reset-password/abc"])(
    "falls back to the app shell for the client route %s",
    async (url) => {
      const res = await serve().inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("<title>shell</title>");
      expect(res.headers["cache-control"]).toBe("no-store");
      expectWebHeaders(res.headers);
    },
  );

  it("serves /assets/* cached for a year and immutable, with the web header set", async () => {
    const res = await serve().inject({ method: "GET", url: "/assets/x.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("export const x = 1;");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expectWebHeaders(res.headers);
  });

  it("keeps a conditional asset hit immutable and never marks an asset directory request immutable", async () => {
    const app = serve();
    const first = await app.inject({ method: "GET", url: "/assets/x.js" });
    const etag = first.headers.etag;
    expect(typeof etag).toBe("string");
    const revalidated = await app.inject({
      method: "GET",
      url: "/assets/x.js",
      headers: { "if-none-match": String(etag) },
    });
    expect(revalidated.statusCode).toBe(304);
    expect(revalidated.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const directory = await app.inject({ method: "GET", url: "/assets/" });
    expect(directory.statusCode).toBe(404);
    expect(directory.headers["cache-control"]).toBe("no-store");
  });

  it("serves a real root file such as the service worker without caching it", async () => {
    const res = await serve().inject({ method: "GET", url: "/sw.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("// service worker");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it.each(["/missing.js", "/assets/missing.js", "/nested/missing.png"])(
    "returns a real 404 with the header set for the missing file %s",
    async (url) => {
      const res = await serve().inject({ method: "GET", url });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("<title>shell</title>");
      expect(res.headers["cache-control"]).toBe("no-store");
      expectWebHeaders(res.headers);
    },
  );
});

describe("static web app boundaries", () => {
  it("does not serve files outside the web directory", async () => {
    const res = await serve().inject({ method: "GET", url: "/assets/..%2F..%2Fpackage.json" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("leaves the API alone: health keeps the API CSP and an unknown API path keeps the API 404", async () => {
    const app = serve();
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.headers["content-security-policy"]).toContain("img-src 'self' data: https:");
    expect(health.headers["content-security-policy"]).not.toContain("script-src");
    const unknown = await app.inject({ method: "GET", url: "/api/nope" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).not.toContain("<title>shell</title>");
    expect(unknown.headers["content-security-policy"]).not.toContain("script-src");
  });

  it("does not rate limit the web app", async () => {
    const app = serve({ rateLimit: 2 });
    for (let i = 0; i < 5; i += 1) {
      expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/assets/x.js" })).statusCode).toBe(200);
    }
  });

  it("serves no web routes without webDir", async () => {
    const app = createApp(openDb(":memory:"));
    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/assets/x.js" })).statusCode).toBe(404);
  });
});
