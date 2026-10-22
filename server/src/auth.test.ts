import { describe, expect, it, vi } from "vitest";
import { hashPasswordWithBackpressure, verifyPasswordWithBackpressure } from "./auth";
import type { PasswordHasher } from "./passwordHasher";
import { WorkQueueFullError } from "./workQueue";
import { parseApiErrorFields, readRejectedValue } from "./authApiErrorTestSupport";

describe("password verification backpressure", () => {
  it("maps scrypt saturation to a retryable service-unavailable API error", async () => {
    const hasher: PasswordHasher = {
      hash: vi.fn(),
      verify: vi.fn().mockRejectedValue(new WorkQueueFullError("Password processing is at capacity.", "full")),
    };

    const error = parseApiErrorFields(
      await readRejectedValue(verifyPasswordWithBackpressure(hasher, { hash: "stored", password: "correct password" })),
    );
    expect(error.status).toBe("SERVICE_UNAVAILABLE");
    expect(error.code).toBe("PASSWORD_PROCESSING_UNAVAILABLE");
  });

  it("maps new-hash saturation to the same retryable service-unavailable API error", async () => {
    const hasher: PasswordHasher = {
      hash: vi.fn().mockRejectedValue(new WorkQueueFullError("Password processing is at capacity.", "full")),
      verify: vi.fn(),
    };

    const error = parseApiErrorFields(
      await readRejectedValue(hashPasswordWithBackpressure(hasher, "correct horse battery staple")),
    );
    expect(error.status).toBe("SERVICE_UNAVAILABLE");
    expect(error.code).toBe("PASSWORD_PROCESSING_UNAVAILABLE");
  });
});
