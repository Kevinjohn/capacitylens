import { afterEach, describe, expect, it, vi } from "vitest";

const handle = "A".repeat(43);

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function fetchStatus(body: unknown) {
  vi.resetModules();
  vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(body)),
  );
  const { fetchAuthStatus } = await import("./fetchAuthStatus");
  return fetchAuthStatus(() => true);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authenticated session handle parsing", () => {
  it("accepts the stable application-local handle without exposing a bearer value", async () => {
    const result = await fetchStatus({
      authMode: "password",
      sessionInstanceId: handle,
      user: { id: "user-1", email: "bruce@example.test" },
    });
    expect(result).toMatchObject({ kind: "pass", sessionInstanceId: handle });
  });

  it.each([undefined, "short", "!".repeat(43), 42])(
    "rejects an absent or malformed auth-on handle: %j",
    async (value) => {
      const result = await fetchStatus({
        authMode: "password",
        ...(value === undefined ? {} : { sessionInstanceId: value }),
        user: { id: "user-1", email: "bruce@example.test" },
      });
      expect(result).toMatchObject({ kind: "error" });
    },
  );

  it("uses an explicit null non-auth sentinel for auth-off and legacy responses", async () => {
    const result = await fetchStatus({ authMode: "off", user: null });
    expect(result).toMatchObject({ kind: "pass", sessionInstanceId: null });
  });
});
