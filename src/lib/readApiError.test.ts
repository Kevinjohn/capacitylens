import { describe, expect, it, vi } from "vitest";
import { peekApiErrorCode, readApiError } from "./readApiError";

const responseWith = (value: unknown): Response => Response.json(value);

describe("readApiError", () => {
  it("returns only a non-empty string error from an object body", async () => {
    const denied = responseWith({ error: "Denied." });
    await expect(readApiError(denied)).resolves.toBe("Denied.");
    await expect(readApiError(denied)).resolves.toBe("Denied.");
    await expect(denied.json()).resolves.toEqual({ error: "Denied." });
    await expect(readApiError(responseWith({ error: "" }))).resolves.toBeUndefined();
    await expect(readApiError(responseWith({ error: " \n\t " }))).resolves.toBeUndefined();
    await expect(readApiError(responseWith({ error: "  Denied.  " }))).resolves.toBe("Denied.");
    await expect(readApiError(responseWith({ error: 403 }))).resolves.toBeUndefined();
    await expect(readApiError(responseWith({}))).resolves.toBeUndefined();
  });

  it.each([null, "Denied.", 42, []])("rejects non-object API bodies: %j", async (body) => {
    await expect(readApiError(responseWith(body))).resolves.toBeUndefined();
  });

  it("falls back cleanly when JSON parsing fails", async () => {
    const response = new Response("invalid JSON", { headers: { "content-type": "application/json" } });
    await expect(readApiError(response)).resolves.toBeUndefined();
  });

  it("falls back cleanly when the response body was already consumed", async () => {
    const response = responseWith({ error: "Denied." });
    await response.json();
    await expect(readApiError(response)).resolves.toBeUndefined();
  });
});

describe("peekApiErrorCode", () => {
  it("reads a string code without consuming the response body", async () => {
    const response = responseWith({ code: "SESSION_NOT_FRESH" });

    await expect(peekApiErrorCode(response)).resolves.toBe("SESSION_NOT_FRESH");
    await expect(response.json()).resolves.toEqual({ code: "SESSION_NOT_FRESH" });
  });

  it("returns null for an unreadable, consumed, or clone-less response", async () => {
    await expect(peekApiErrorCode(responseWith({ error: "Denied." }))).resolves.toBeNull();
    await expect(peekApiErrorCode(new Response("invalid JSON"))).resolves.toBeNull();

    const consumed = responseWith({ code: "SESSION_NOT_FRESH" });
    await consumed.json();
    await expect(peekApiErrorCode(consumed)).resolves.toBeNull();

    const json = vi.fn(async () => ({ code: "SESSION_NOT_FRESH" }));
    await expect(peekApiErrorCode({ bodyUsed: false, json } as Response)).resolves.toBeNull();
    expect(json).not.toHaveBeenCalled();
  });
});
