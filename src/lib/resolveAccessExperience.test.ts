import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

async function accessExperience(demo: string, authMode: "off" | "password-only" | "sso-only") {
  vi.stubEnv("VITE_CAPACITYLENS_DEMO", demo);
  vi.resetModules();
  const { resolveAccessExperience } = await import("./resolveAccessExperience");
  return resolveAccessExperience(authMode);
}

describe("accessExperienceFor", () => {
  it("reports the explicit demo before authentication posture", async () => {
    await expect(accessExperience("1", "password-only")).resolves.toBe("demo");
  });

  it("distinguishes an auth-off server from authenticated server modes", async () => {
    await expect(accessExperience("", "off")).resolves.toBe("open");
    await expect(accessExperience("", "password-only")).resolves.toBe("authenticated");
    await expect(accessExperience("", "sso-only")).resolves.toBe("authenticated");
  });
});
