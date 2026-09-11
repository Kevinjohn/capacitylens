import { afterEach, describe, expect, it, vi } from "vitest";

// buildStamp() reads VITE_CAPACITYLENS_BUILD_SHA at call time, but the server/demo suffix comes
// from apiConfig (server is the default; the demo build sets VITE_CAPACITYLENS_DEMO=1), resolved at
// import. So, like apiConfig.test, each case stubs the env, resets the module registry, and re-imports.

afterEach(() => vi.unstubAllEnvs());

async function freshBuildInfo() {
  vi.resetModules();
  return import("./buildInfo");
}

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
    const report = readDiagnostics(null, observedAt);

    expect(report.observedAt).toBe(observedAt);
    expect(formatDiagnostics(report)).toContain(`Snapshot observed: ${observedAt}`);
  });

  it("leaves the observation time empty until a snapshot or failure is classified", async () => {
    const { readDiagnostics, formatDiagnostics } = await freshBuildInfo();
    expect(readDiagnostics().observedAt).toBeNull();
    expect(readDiagnostics(null, "not-a-timestamp").observedAt).toBeNull();
    expect(formatDiagnostics(readDiagnostics())).toContain("Snapshot observed: Unknown");
  });
});

describe("diagnostics projection privacy", () => {
  it("keeps only the fixed allowlist and validates server values", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "A1B2C3D4");
    const { readDiagnostics, formatDiagnostics } = await freshBuildInfo();
    const report = readDiagnostics({
      server: {
        connectivity: "ok",
        database: { status: "ok", schemaVersion: 37, secret: "password" },
        persistence: "degraded",
        backup: { status: "ok", lastSuccessAt: "2026-09-10T12:00:00.000Z", sessionId: "secret" },
        password: "should never be copied",
      },
      inviteToken: "never copy",
    });
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
    const report = readDiagnostics({
      server: {
        connectivity: true,
        database: { status: "ok", schemaVersion: 37.5 },
        persistence: "raw error",
        backup: { status: "ok", lastSuccessAt: "database password" },
      },
    });
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
    const report = readDiagnostics({
      server: {
        connectivity: "ok",
        database: { status: "unavailable", schemaVersion: 38 },
        persistence: "unknown",
        backup: { status: "ok", lastSuccessAt: "2026-02-31T12:00:00.000Z" },
      },
    });
    expect(report.server.database).toEqual({ status: "unavailable", schemaVersion: null });
    expect(report.server.backup).toEqual({ status: "ok", lastSuccessAt: null });
  });
});
