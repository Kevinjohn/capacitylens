import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

async function accessExperience(demo: string) {
  vi.stubEnv("VITE_CAPACITYLENS_DEMO", demo);
  vi.resetModules();
  const { resolveAccessExperience } = await import("./resolveAccessExperience");
  return resolveAccessExperience();
}

describe("accessExperienceFor", () => {
  it("reports the explicit demo before authentication posture", async () => {
    await expect(accessExperience("1")).resolves.toBe("demo");
  });

  it("never presents a persisted server as open access", async () => {
    await expect(accessExperience("")).resolves.toBe("authenticated");
  });
});
