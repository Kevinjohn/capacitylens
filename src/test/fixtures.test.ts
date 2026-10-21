import { describe, expect, it } from "vitest";
import { jsonResponse } from "./fixtures";

// Create a fresh Response per fetch invocation because its body is single-use;
// reusing an instance makes the next decoder reject an already-consumed body.

describe("jsonResponse", () => {
  it("builds an ok JSON response with the body verbatim", async () => {
    const response = jsonResponse({ members: [{ id: "u1" }] });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ members: [{ id: "u1" }] });
  });

  it("carries an explicit failure status for non-ok branches", async () => {
    const response = jsonResponse({ error: "Forbidden." }, 403);

    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden." });
  });

  it("returns a FRESH response each call, because a body is a single-use stream", async () => {
    const first = jsonResponse({ n: 1 });
    const second = jsonResponse({ n: 1 });

    expect(first).not.toBe(second);
    await expect(first.json()).resolves.toEqual({ n: 1 });
    await expect(second.json()).resolves.toEqual({ n: 1 });
  });
});
