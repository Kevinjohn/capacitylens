import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

async function accessExperience(
  demo: string,
  authMode: "off" | "password" | "sso",
) {
  vi.stubEnv("VITE_CAPACITYLENS_DEMO", demo);
  vi.resetModules();
  const { accessExperienceFor } = await import("./accessMode");
  return accessExperienceFor(authMode);
}

describe("accessExperienceFor", () => {
  it("reports the explicit demo before authentication posture", async () => {
    await expect(accessExperience("1", "password")).resolves.toBe("demo");
  });

  it("distinguishes an auth-off server from authenticated server modes", async () => {
    await expect(accessExperience("", "off")).resolves.toBe("open");
    await expect(accessExperience("", "password")).resolves.toBe(
      "authenticated",
    );
    await expect(accessExperience("", "sso")).resolves.toBe("authenticated");
  });
});
