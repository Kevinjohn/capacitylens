import { afterEach, describe, expect, it, vi } from "vitest";

// buildStamp() reads VITE_CAPACITYLENS_BUILD_SHA at call time, but the server/demo suffix comes
// from apiConfig (server is the default; the demo build sets VITE_CAPACITYLENS_DEMO=1), resolved at
// import. So, like apiConfig.test, each case stubs the env, resets the module registry, and re-imports.

afterEach(() => vi.unstubAllEnvs());

async function freshBuildInfo() {
  vi.resetModules();
  return import("./buildInfo");
}

const client = {
  signInMode: "sso-only",
  persistence: {
    savesFailed: 2,
    retriesArmed: 1,
    reconciliationsResolved: 0,
    reloadsSuperseded: 0,
    editsRebased: 3,
    editsDiscarded: 0,
    suspended: false,
  },
  browser: {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    viewport: "1280×800",
    timeZone: "Europe/London",
    language: "en-GB",
  },
} as const;

async function freshBuildStamp() {
  const { readBuildStamp } = await freshBuildInfo();
  return readBuildStamp;
}

describe("buildStamp", () => {
  it("is null when VITE_CAPACITYLENS_BUILD_SHA is unset (today's UI — render nothing)", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "");
    const buildStamp = await freshBuildStamp();
    expect(buildStamp()).toBeNull();
  });

  it("is null for a whitespace-only sha", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "   ");
    const buildStamp = await freshBuildStamp();
    expect(buildStamp()).toBeNull();
  });

  it("reports demo mode when VITE_CAPACITYLENS_DEMO=1", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "a1b2c3d");
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1");
    const buildStamp = await freshBuildStamp();
    expect(buildStamp()).toBe("build a1b2c3d · demo");
  });

  it("reports server mode by default (server is the default; no demo flag)", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "a1b2c3d");
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "");
    const buildStamp = await freshBuildStamp();
    expect(buildStamp()).toBe("build a1b2c3d · server");
  });
  // No separate "VITE_CAPACITYLENS_API configured" case: the label now flips on the demo flag only
  // (isServerConfigured ignores API_BASE — empty same-origin vs explicit origin both read `· server`),
  // so it would exercise the identical branch + assert the identical string as the default case above.
});

describe("feedbackMailto", () => {
  it("is null when VITE_CAPACITYLENS_FEEDBACK_MAILTO is unset (render nothing)", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_FEEDBACK_MAILTO", "");
    const { readFeedbackMailto } = await freshBuildInfo();
    expect(readFeedbackMailto()).toBeNull();
  });

  it("pins the subject to the build stamp when there is one", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_FEEDBACK_MAILTO", "owner@example.com");
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "a1b2c3d");
    vi.stubEnv("VITE_CAPACITYLENS_API", "https://api.example.com");
    const { readFeedbackMailto } = await freshBuildInfo();
    expect(readFeedbackMailto()).toBe(
      `mailto:owner@example.com?subject=${encodeURIComponent("CapacityLens feedback — build a1b2c3d · server")}`,
    );
  });

  it("falls back to a plain subject without a build stamp", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_FEEDBACK_MAILTO", "owner@example.com");
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "");
    const { readFeedbackMailto } = await freshBuildInfo();
    expect(readFeedbackMailto()).toBe(
      `mailto:owner@example.com?subject=${encodeURIComponent("CapacityLens feedback")}`,
    );
  });

  it("encodes reserved characters as part of a valid recipient mailbox", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_FEEDBACK_MAILTO", "owner?reports@example.com");
    const { readFeedbackMailto } = await freshBuildInfo();
    expect(readFeedbackMailto()).toBe(
      `mailto:owner%3Freports@example.com?subject=${encodeURIComponent("CapacityLens feedback")}`,
    );
  });

  it.each(["not-an-email-address", "two@@example.com", "owner @example.com"])(
    "renders no feedback link for an invalid mailbox: %s",
    async (value) => {
      vi.stubEnv("VITE_CAPACITYLENS_FEEDBACK_MAILTO", value);
      const { readFeedbackMailto } = await freshBuildInfo();
      expect(readFeedbackMailto()).toBeNull();
    },
  );
});

describe("diagnostics projection", () => {
  it("records when the client observed the point-in-time snapshot", async () => {
    const { readDiagnostics, formatDiagnostics } = await freshBuildInfo();
    const observedAt = "2026-09-11T10:11:12.123Z";
    const report = readDiagnostics(null, observedAt, client);

    expect(report.observedAt).toBe(observedAt);
    expect(formatDiagnostics(report)).toContain(`Snapshot observed: ${observedAt}`);
  });

  it("leaves the observation time empty until a snapshot or failure is classified", async () => {
    const { readDiagnostics, formatDiagnostics } = await freshBuildInfo();
    expect(readDiagnostics(null, undefined, client).observedAt).toBeNull();
    expect(readDiagnostics(null, "not-a-timestamp", client).observedAt).toBeNull();
    expect(formatDiagnostics(readDiagnostics(null, undefined, client))).toContain("Snapshot observed: Unknown");
  });

  it("returns a fresh unavailable server projection for each read", async () => {
    const { readDiagnostics } = await freshBuildInfo();
    const first = readDiagnostics(null, undefined, client);
    const second = readDiagnostics(null, undefined, client);

    first.server.connectivity = "ok";
    first.server.database.status = "ok";
    first.server.database.schemaVersion = 37;
    first.server.persistence = "degraded";
    first.server.backup.status = "ok";
    first.server.backup.lastSuccessAt = "2026-09-10T12:00:00.000Z";

    expect(second.server).toEqual({
      connectivity: "unavailable",
      database: { status: "unavailable", schemaVersion: null },
      persistence: "unknown",
      backup: { status: "unavailable", lastSuccessAt: null },
    });
  });
});

describe("diagnostics projection privacy", () => {
  it("keeps only the fixed allowlist and validates server values", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "A1B2C3D4");
    const { readDiagnostics, formatDiagnostics } = await freshBuildInfo();
    const report = readDiagnostics(
      {
        server: {
          connectivity: "ok",
          database: { status: "ok", schemaVersion: 37, secret: "password" },
          persistence: "degraded",
          backup: { status: "ok", lastSuccessAt: "2026-09-10T12:00:00.000Z", sessionId: "secret" },
          password: "should never be copied",
        },
        inviteToken: "never copy",
      },
      undefined,
      client,
    );
    expect(report.buildRevision).toBe("A1B2C3D4");
    expect(report.server).toEqual({
      connectivity: "ok",
      database: { status: "ok", schemaVersion: 37 },
      persistence: "degraded",
      backup: { status: "ok", lastSuccessAt: "2026-09-10T12:00:00.000Z" },
    });
    expect(formatDiagnostics(report)).not.toMatch(/password|sessionId|inviteToken|secret/i);
  });

  it("rejects non-hex revisions, invalid schema values, statuses and timestamps", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "revision-with-private-path");
    const { readDiagnostics } = await freshBuildInfo();
    const report = readDiagnostics(
      {
        server: {
          connectivity: true,
          database: { status: "ok", schemaVersion: 37.5 },
          persistence: "raw error",
          backup: { status: "ok", lastSuccessAt: "database password" },
        },
      },
      undefined,
      client,
    );
    expect(report.buildRevision).toBeNull();
    expect(report.server).toEqual({
      connectivity: "unavailable",
      database: { status: "unavailable", schemaVersion: null },
      persistence: "unknown",
      backup: { status: "ok", lastSuccessAt: null },
    });
  });

  it("clears schema and rejects non-canonical timestamps from unavailable projections", async () => {
    const { readDiagnostics } = await freshBuildInfo();
    const report = readDiagnostics(
      {
        server: {
          connectivity: "ok",
          database: { status: "unavailable", schemaVersion: 38 },
          persistence: "unknown",
          backup: { status: "ok", lastSuccessAt: "2026-02-31T12:00:00.000Z" },
        },
      },
      undefined,
      client,
    );
    expect(report.server.database).toEqual({ status: "unavailable", schemaVersion: null });
    expect(report.server.backup).toEqual({ status: "ok", lastSuccessAt: null });
  });
});

describe("diagnostics client facts", () => {
  it("adds the sign-in mode, persistence counters and browser details", async () => {
    const { readDiagnostics, formatDiagnostics } = await freshBuildInfo();
    const text = formatDiagnostics(readDiagnostics(null, undefined, client));

    for (const line of [
      "Sign-in mode: sso-only",
      "Saves failed: 2",
      "Retries armed: 1",
      "Edits rebased: 3",
      "Saving suspended: no",
      `User agent: ${client.browser.userAgent}`,
      "Viewport: 1280×800",
      "Time zone: Europe/London",
      "Language: en-GB",
    ]) {
      expect(text).toContain(line);
    }
  });

  it("excludes names, email addresses, identifiers and hosts from every input", async () => {
    const { readDiagnostics, formatDiagnostics } = await freshBuildInfo();
    const accountName = "Wayne Enterprises";
    const id = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
    const text = formatDiagnostics(
      readDiagnostics(
        {
          account: { id, name: accountName },
          user: { email: "bruce.wayne@wayne.example", name: "Bruce Wayne" },
          server: {
            connectivity: "ok",
            database: { status: "ok", schemaVersion: 38, path: "/srv/capacitylens/app.db" },
            persistence: "unknown",
            backup: { status: "ok", lastSuccessAt: "2026-09-10T12:00:00.000Z", target: "https://backups.example" },
            accountId: id,
          },
        },
        "2026-09-11T10:11:12.123Z",
        {
          ...client,
          browser: {
            userAgent: `Agent\u0000${accountName}`,
            viewport: "wide",
            timeZone: "https://zones.example/London",
            language: "bruce.wayne@wayne.example",
          },
        },
      ),
    );

    expect(text).not.toContain("@");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toContain(accountName);
    expect(text).not.toContain("Bruce Wayne");
    expect(text).not.toMatch(/https?:\/\/|\.example|\/srv\//);
    expect(text).toContain("User agent: Unknown");
    expect(text).toContain("Viewport: Unknown");
  });

  it("drops a printable user agent that carries a URL or an email address", async () => {
    const { readDiagnostics, formatDiagnostics } = await freshBuildInfo();
    for (const userAgent of ["Mozilla/5.0 (+https://crawler.example/bot)", "Mozilla/5.0 bruce@wayne.example"]) {
      const text = formatDiagnostics(
        readDiagnostics(null, undefined, { ...client, browser: { ...client.browser, userAgent } }),
      );
      expect(text).toContain("User agent: Unknown");
    }
  });

  it("reads the browser facts in their expected shape", async () => {
    const { readBrowserDiagnostics } = await freshBuildInfo();
    const browser = readBrowserDiagnostics();
    expect(browser.viewport).toMatch(/^\d+×\d+$/);
    expect(browser.timeZone).not.toBe("");
    expect(browser.language).not.toBe("");
  });
});
