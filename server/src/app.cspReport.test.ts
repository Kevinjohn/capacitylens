import { beforeEach, describe, expect, it } from "vitest";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { createApp } from "./app";
import { openDb } from "./db";
import { PASSWORD_ENV } from "./testHelpers";

describe("CSP violation reporting", () => {
  let events: Record<string, unknown>[];

  beforeEach(() => {
    events = [];
  });

  function createLegacyReportTest(): void {
    it("accepts a legacy browser report without a session and strips URL paths and queries", async () => {
      const db = openDb(":memory:");
      const { mode, auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
      if (!auth) throw new Error("Expected auth configuration.");
      await runAuthMigrations(auth);
      const app = createApp(db, {
        authMode: mode,
        auth,
        securityLog: (event) => events.push(event),
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/security/csp-report",
        headers: {
          "content-type": "application/csp-report",
          host: "localhost:8787",
          origin: "http://localhost:8787",
          "sec-fetch-site": "same-origin",
        },
        payload: JSON.stringify({
          "csp-report": {
            "document-uri": "https://capacity.example.com/private/path?token=secret",
            "blocked-uri": "https://cdn.example.net/script.js?code=secret",
            "effective-directive": "script-src-elem",
            "violated-directive": "script-src",
            disposition: "enforce",
          },
        }),
      });

      expect(response.statusCode).toBe(204);
      expect(events).toEqual([
        {
          event: "csp_violation",
          outcome: "reported",
          documentOrigin: "https://capacity.example.com",
          blockedOrigin: "https://cdn.example.net",
          effectiveDirective: "script-src-elem",
          violatedDirective: "script-src",
          disposition: "enforce",
        },
      ]);
      expect(JSON.stringify(events)).not.toContain("secret");
      await app.close();
      db.close();
    });
  }

  function createReportingApiTest(): void {
    it("accepts the Reporting API array format and bounds one request to one event", async () => {
      const app = createApp(openDb(":memory:"), { securityLog: (event) => events.push(event) });
      const reports = Array.from({ length: 25 }, () => ({
        type: "csp-violation",
        body: {
          documentURL: "https://capacity.example.com/",
          blockedURL: "inline",
          effectiveDirective: "style-src-elem",
          disposition: "report",
        },
      }));
      const response = await app.inject({
        method: "POST",
        url: "/api/security/csp-report",
        headers: { "content-type": "application/reports+json" },
        payload: JSON.stringify(reports),
      });

      expect(response.statusCode).toBe(204);
      expect(events).toHaveLength(1);
      const event = events[0];
      if (!event) throw new Error("Expected one CSP security event.");
      expect(event).toMatchObject({ blockedOrigin: "inline", effectiveDirective: "style-src-elem" });
      await app.close();
    });
  }

  function createMalformedReportTest(): void {
    it("rejects malformed, oversized and cross-site report submissions", async () => {
      const app = createApp(openDb(":memory:"), { securityLog: (event) => events.push(event) });
      const malformed = await app.inject({
        method: "POST",
        url: "/api/security/csp-report",
        headers: { "content-type": "application/csp-report" },
        payload: "{",
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toEqual({ error: "Malformed CSP report" });

      const oversized = await app.inject({
        method: "POST",
        url: "/api/security/csp-report",
        headers: { "content-type": "application/csp-report" },
        payload: JSON.stringify({ padding: "x".repeat(65 * 1024) }),
      });
      expect(oversized.statusCode).toBe(413);
      expect(oversized.json()).toEqual({ error: "Request body is too large" });

      const crossSite = await app.inject({
        method: "POST",
        url: "/api/security/csp-report",
        headers: {
          "content-type": "application/csp-report",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        payload: "{}",
      });
      expect(crossSite.statusCode).toBe(403);
      expect(events).toContainEqual(expect.objectContaining({ event: "cross_site_request", outcome: "blocked" }));
      await app.close();
    });
  }

  createLegacyReportTest();
  createReportingApiTest();
  createMalformedReportTest();
});
