import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { me } from "./testAuthResponse";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function freshProvider() {
  vi.resetModules();
  const { AuthProvider } = await import("./AuthProvider");
  const { useAuth } = await import("./authContext");
  return { AuthProvider, useAuth };
}

function SessionHandleProbe({
  useAuth,
}: {
  useAuth: () => { sessionInstanceId?: string | null; refreshAuth: () => Promise<void> };
}) {
  const { sessionInstanceId, refreshAuth } = useAuth();
  return (
    <button type="button" onClick={() => void refreshAuth()}>
      {sessionInstanceId ?? "none"}
    </button>
  );
}

describe("AuthProvider application session handle", () => {
  it("preserves a same-session handle and carries a replacement handle", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          me(200, {
            authMode: "password",
            user: { id: "u1", email: "bruce@example.test" },
            sessionInstanceId: "A".repeat(43),
          }),
        )
        .mockResolvedValueOnce(
          me(200, {
            authMode: "password",
            user: { id: "u1", email: "bruce@example.test" },
            sessionInstanceId: "A".repeat(43),
          }),
        )
        .mockResolvedValueOnce(
          me(200, {
            authMode: "password",
            user: { id: "u1", email: "bruce@example.test" },
            sessionInstanceId: "B".repeat(43),
          }),
        ),
    );
    const { AuthProvider, useAuth } = await freshProvider();
    render(
      <AuthProvider>
        <SessionHandleProbe useAuth={useAuth} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "A".repeat(43) }));
    expect(await screen.findByRole("button", { name: "A".repeat(43) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A".repeat(43) }));
    expect(await screen.findByRole("button", { name: "B".repeat(43) })).toBeInTheDocument();
  });
});
