import { describe, expect, it, vi } from "vitest";
import {
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  MAX_HIBP_RESPONSE_BYTES,
  MAX_CONCURRENT_HIBP,
  MAX_QUEUED_HIBP,
  MAX_CONCURRENT_SCRYPT,
  MAX_QUEUED_SCRYPT,
  assertNoContextSpecificPassword,
  assertPasswordNotBreached,
  scryptPasswordHasher,
} from "./passwordSecurity";
import { WorkQueueFullError } from "./workQueue";
import { runWithRequestAbortSignal } from "./requestAbort";

describe("OWASP password storage profile", () => {
  it("pins the production scrypt parameters", () => {
    expect(SCRYPT_N).toBe(2 ** 17);
    expect(SCRYPT_R).toBe(8);
    expect(SCRYPT_P).toBe(1);
    expect(MAX_CONCURRENT_SCRYPT).toBe(2);
    expect(MAX_QUEUED_SCRYPT).toBe(16);
    expect(MAX_CONCURRENT_HIBP).toBe(8);
    expect(MAX_QUEUED_HIBP).toBe(32);
  });

  it("round-trips exact password bytes with a fast test work factor", async () => {
    const hasher = scryptPasswordHasher(2 ** 10);
    const password = "correct horse battery staple 🦄";
    const hash = await hasher.hash(password);
    expect(hash).toMatch(/^scrypt-v1\$1024\$8\$1\$/);
    await expect(hasher.verify({ hash, password })).resolves.toBe(true);
    await expect(hasher.verify({ hash, password: password.normalize("NFKC") + "x" })).resolves.toBe(false);
    await expect(hasher.verify({ hash: "malformed", password })).resolves.toBe(false);
    await expect(hasher.verify({ hash: "scrypt-v1$1024$8$1$bad$bad", password })).resolves.toBe(false);
  });

  it("surfaces scrypt queue pressure instead of returning a false credential verdict", async () => {
    const hasher = scryptPasswordHasher(2 ** 10);
    const password = "correct horse battery staple 🦄";
    const versionedHash = await hasher.hash(password);
    const legacyShape = `${"ab".repeat(16)}:${"cd".repeat(64)}`;

    for (const hash of [versionedHash, legacyShape]) {
      const occupying = Array.from({ length: MAX_CONCURRENT_SCRYPT + MAX_QUEUED_SCRYPT }, (_, index) =>
        hasher.hash(`queue-occupant-${index}`),
      );
      try {
        await expect(hasher.verify({ hash, password })).rejects.toThrow(
          "Password processing is temporarily at capacity.",
        );
      } finally {
        await Promise.all(occupying);
      }
    }
  });

  it("rejects documented context-specific words", () => {
    expect(() => assertNoContextSpecificPassword("CapacityLens-is-great-2026")).toThrow(/product name/i);
    expect(() => assertNoContextSpecificPassword("correct horse battery staple")).not.toThrow();
  });
});

describe("breached-password range check", () => {
  it("withdraws an abandoned queued lookup before admitting the next live request", async () => {
    const releases: Array<() => void> = [];
    let invocations = 0;
    const fetcher = (async () => {
      invocations += 1;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            releases.push(() => {
              controller.enqueue(new TextEncoder().encode("AAAA:1"));
              controller.close();
            });
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const active = Array.from({ length: MAX_CONCURRENT_HIBP }, (_, index) =>
      assertPasswordNotBreached(`active-${index}`, fetcher),
    );
    await vi.waitFor(() => expect(invocations).toBe(MAX_CONCURRENT_HIBP));
    const controller = new AbortController();
    const abandoned = runWithRequestAbortSignal(controller.signal, () =>
      assertPasswordNotBreached("abandoned", fetcher),
    );
    const useful = assertPasswordNotBreached("useful", fetcher);

    controller.abort(new Error("request gone"));
    await expect(abandoned).rejects.toMatchObject({
      code: "PASSWORD_CHECK_UNAVAILABLE",
      cause: expect.objectContaining({ message: "request gone" }),
    });
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(invocations).toBe(MAX_CONCURRENT_HIBP + 1));
    releases.splice(0).forEach((release) => release());

    await expect(Promise.all([...active, useful])).resolves.toEqual(Array(MAX_CONCURRENT_HIBP + 1).fill(undefined));
    expect(invocations).toBe(MAX_CONCURRENT_HIBP + 1);
  });

  it("rejects a matching suffix without sending the password or full digest", async () => {
    let requested = "";
    let init: RequestInit | undefined;
    const fetcher = (async (input: string | URL | Request, requestInit?: RequestInit) => {
      requested = String(input);
      init = requestInit;
      // SHA-1("password") = 5BAA6 1E4C9B93F3F0682250B6CF8331B7EE68FD8
      return new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:999\nFFFF:0", {
        status: 200,
      });
    }) as typeof fetch;
    await expect(assertPasswordNotBreached("password", fetcher)).rejects.toThrow(/known breach/i);
    expect(requested.endsWith("/5BAA6")).toBe(true);
    expect(new URL(requested).pathname).not.toContain("password");
    expect(new URL(requested).pathname).not.toContain("1E4C9B93");
    expect(init?.redirect).toBe("error");
  });

  it("accepts a missing suffix and fails closed when the service is unavailable", async () => {
    const clean = (async () => new Response("AAAA:1", { status: 200 })) as typeof fetch;
    await expect(assertPasswordNotBreached("not-in-the-response", clean)).resolves.toBeUndefined();
    const down = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await expect(assertPasswordNotBreached("anything", down)).rejects.toThrow(/temporarily unavailable/i);
  });

  it("fails closed before reading an oversized service response", async () => {
    const oversized = (async () =>
      new Response("ignored", {
        status: 200,
        headers: { "Content-Length": String(MAX_HIBP_RESPONSE_BYTES + 1) },
      })) as typeof fetch;
    await expect(assertPasswordNotBreached("anything", oversized)).rejects.toThrow(/response was invalid/i);
  });

  it("holds each queue slot until its bounded response body finishes", async () => {
    let fetcherInvocations = 0;
    const releaseBodies: Array<() => void> = [];
    const fetcher = (async () => {
      fetcherInvocations += 1;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            releaseBodies.push(() => {
              controller.enqueue(new TextEncoder().encode("AAAA:1"));
              controller.close();
            });
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const attempts = Array.from({ length: MAX_CONCURRENT_HIBP + MAX_QUEUED_HIBP }, (_, index) =>
      assertPasswordNotBreached(`held-body-${index}`, fetcher),
    );
    const reportSaturation = vi.fn();
    const overflow = runWithRequestAbortSignal(
      new AbortController().signal,
      () => assertPasswordNotBreached("held-body-overflow", fetcher),
      reportSaturation,
    );
    await expect(overflow).rejects.toMatchObject({
      code: "PASSWORD_CHECK_UNAVAILABLE",
      cause: expect.any(WorkQueueFullError),
    });
    expect(reportSaturation).toHaveBeenCalledOnce();
    expect(reportSaturation).toHaveBeenCalledWith("hibp", "full");
    expect(fetcherInvocations).toBe(MAX_CONCURRENT_HIBP);

    for (
      let expectedStarted = MAX_CONCURRENT_HIBP * 2;
      expectedStarted <= MAX_CONCURRENT_HIBP + MAX_QUEUED_HIBP;
      expectedStarted += MAX_CONCURRENT_HIBP
    ) {
      releaseBodies.splice(0).forEach((release) => release());
      await vi.waitFor(() => expect(fetcherInvocations).toBe(expectedStarted));
    }
    releaseBodies.splice(0).forEach((release) => release());
    await expect(Promise.all(attempts)).resolves.toEqual(Array(MAX_CONCURRENT_HIBP + MAX_QUEUED_HIBP).fill(undefined));
  });
});
