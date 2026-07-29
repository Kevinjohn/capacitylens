import { describe, expect, it } from "vitest";
import { readApiError } from "./readApiError";

const responseWith = (value: unknown): Response => Response.json(value);

describe("readApiError", () => {
  it("returns only a non-empty string error from an object body", async () => {
    const denied = responseWith({ error: "Denied." });
    await expect(readApiError(denied)).resolves.toBe("Denied.");
    await expect(readApiError(denied)).resolves.toBe("Denied.");
    await expect(denied.json()).resolves.toEqual({ error: "Denied." });
    await expect(readApiError(responseWith({ error: "" }))).resolves.toBeUndefined();
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
});
