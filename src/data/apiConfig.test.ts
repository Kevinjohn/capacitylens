import { afterEach, describe, expect, it, vi } from "vitest";

// isServerConfigured() is the single switch between server persistence (the DEFAULT — same-origin or
// a configured API_BASE) and the in-memory demo build (VITE_CAPACITYLENS_DEMO=1). API_BASE is a
// module-level const evaluated ONCE at import, so each
// case must stub the env, reset the module registry, then dynamically re-import — importing at the
// top would freeze API_BASE to '' before any stub runs and silently fail the "configured" case.

afterEach(() => vi.unstubAllEnvs());

describe("apiConfig", () => {
  it("defaults to server mode when nothing is set (empty API_BASE = same-origin server)", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "");
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "");
    vi.resetModules();
    const { isServerConfigured, isDemoMode, API_BASE } = await import("./apiConfig");
    expect(isServerConfigured()).toBe(true);
    expect(isDemoMode()).toBe(false);
    expect(API_BASE).toBe("");
  });

  it("is demo mode (not server) when VITE_CAPACITYLENS_DEMO=1", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1");
    vi.resetModules();
    const { isServerConfigured, isDemoMode } = await import("./apiConfig");
    expect(isDemoMode()).toBe(true);
    expect(isServerConfigured()).toBe(false);
  });

  it("stays server mode with an explicit API origin (API_BASE carries the value)", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "https://api.example.com");
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "");
    vi.resetModules();
    const { isServerConfigured, isDemoMode, API_BASE } = await import("./apiConfig");
    expect(isServerConfigured()).toBe(true);
    expect(isDemoMode()).toBe(false);
    expect(API_BASE).toBe("https://api.example.com");
  });

  it("demo wins over even an invalid configured API (demo never consumes the endpoint)", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "file:///tmp/ignored");
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1");
    vi.resetModules();
    const { API_BASE, isServerConfigured, isDemoMode } = await import("./apiConfig");
    expect(isDemoMode()).toBe(true);
    expect(isServerConfigured()).toBe(false);
    expect(API_BASE).toBe("");
  });

  it("trims surrounding whitespace and canonicalizes an origin", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "  https://API.EXAMPLE.com:443///  ");
    vi.resetModules();
    const { API_BASE, isServerConfigured } = await import("./apiConfig");
    expect(API_BASE).toBe("https://api.example.com");
    expect(isServerConfigured()).toBe(true);
  });

  it.each([
    "https://user:secret@api.example.com",
    "https://api.example.com/base",
    "https://api.example.com?tenant=one",
    "https://api.example.com/#/",
    "https://api.example.com/#///",
    "file:///tmp/capacitylens-api",
  ])("rejects a configured API value that is not an HTTP(S) origin: %s", async (value) => {
    vi.stubEnv("VITE_CAPACITYLENS_API", value);
    vi.resetModules();
    await expect(import("./apiConfig")).rejects.toThrow(/HTTP\(S\) origin/);
  });
});
