import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../../auth/authContext";
import { incrementPersistenceDiagnostic, resetPersistenceDiagnostics } from "../../data/persistenceDiagnostics";
import { DiagnosticsView } from "./DiagnosticsView";

const fetchMock = vi.hoisted(() => ({ fetch: vi.fn() }));

beforeEach(() => {
  resetPersistenceDiagnostics();
  vi.stubGlobal("fetch", fetchMock.fetch);
  fetchMock.fetch.mockReset();
  fetchMock.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      server: {
        connectivity: "ok",
        database: { status: "ok", schemaVersion: 38 },
        persistence: "unknown",
        backup: { status: "unavailable", lastSuccessAt: null },
      },
    }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const reportText = () => screen.getByTestId("diagnostics-report-text");

describe("DiagnosticsView — report", () => {
  it("shows client diagnostics in demo mode without requesting the server route", () => {
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1");
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "a1b2c3d");
    render(<DiagnosticsView />);

    expect(screen.getByRole("heading", { name: "Diagnostics", level: 1 })).toBeInTheDocument();
    expect(reportText()).toHaveTextContent("Build revision: a1b2c3d");
    expect(reportText()).toHaveTextContent("Deployment mode: demo");
    expect(reportText()).toHaveTextContent("Database: unavailable");
    expect(reportText()).toHaveTextContent("Sign-in mode: off");
    expect(reportText()).toHaveTextContent(/Time zone: \S+/);
    expect(fetchMock.fetch).not.toHaveBeenCalled();
  });

  it("adds the sign-in mode and live persistence counters", () => {
    render(
      <AuthContext.Provider
        value={{
          authMode: "password-and-sso",
          user: { id: "u-1", name: "Bruce Wayne", email: "bruce@wayne.example" },
          canCreateAccount: false,
          multiAccount: false,
          refreshAuth: async () => {},
          signOut: async () => {},
        }}
      >
        <DiagnosticsView />
      </AuthContext.Provider>,
    );

    expect(reportText()).toHaveTextContent("Sign-in mode: password-and-sso");
    expect(reportText()).toHaveTextContent("Saves failed: 0");
    act(() => incrementPersistenceDiagnostic("savesFailed"));
    expect(reportText()).toHaveTextContent("Saves failed: 1");
    expect(reportText()).not.toHaveTextContent("Bruce Wayne");
    expect(reportText()).not.toHaveTextContent("@");
  });

  it("keeps a safe server projection from a non-OK response", async () => {
    fetchMock.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        server: {
          connectivity: "ok",
          database: { status: "unavailable", schemaVersion: null },
          persistence: "unknown",
          backup: { status: "degraded", lastSuccessAt: "2026-09-10T12:00:00.000Z" },
          secret: "must not render",
        },
      }),
    });
    render(<DiagnosticsView />);

    await waitFor(() => expect(reportText()).toHaveTextContent("Backup: degraded"));
    expect(reportText()).toHaveTextContent("Database: unavailable");
    expect(reportText()).toHaveTextContent("Backup last success: 2026-09-10T12:00:00.000Z");
    expect(reportText()).not.toHaveTextContent("must not render");
  });
});

describe("DiagnosticsView — observation", () => {
  it("records the client time when a diagnostics snapshot fails", async () => {
    const observedAt = "2026-09-11T10:11:12.123Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(observedAt));
    fetchMock.fetch.mockRejectedValueOnce(new TypeError("offline"));
    try {
      render(<DiagnosticsView />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(reportText()).toHaveTextContent(`Snapshot observed: ${observedAt}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a pending server snapshot unobserved until its response arrives", async () => {
    const observedAt = "2026-09-11T10:11:12.123Z";
    let resolveResponse: ((response: unknown) => void) | undefined;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(observedAt));
    fetchMock.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );
    try {
      render(<DiagnosticsView />);
      expect(reportText()).toHaveTextContent("Snapshot observed: Unknown");

      await act(async () => {
        resolveResponse?.({
          ok: true,
          json: async () => ({
            server: {
              connectivity: "ok",
              database: { status: "ok", schemaVersion: 38 },
              persistence: "unknown",
              backup: { status: "unavailable", lastSuccessAt: null },
            },
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(reportText()).toHaveTextContent(`Snapshot observed: ${observedAt}`);
      expect(reportText()).toHaveTextContent("Database schema: 38");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DiagnosticsView — clipboard", () => {
  it("copies the shown report and reports both clipboard success and failure", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as unknown as Clipboard);
    render(<DiagnosticsView />);

    await waitFor(() => expect(reportText()).toHaveTextContent("Database schema: 38"));
    const fetchCountBeforeCopy = fetchMock.fetch.mock.calls.length;

    await user.click(screen.getByTestId("copy-diagnostics"));
    expect(writeText).toHaveBeenCalledWith(reportText().textContent);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("CapacityLens diagnostics"));
    expect(fetchMock.fetch).toHaveBeenCalledTimes(fetchCountBeforeCopy);
    expect(screen.getByRole("status")).toHaveTextContent("Diagnostics copied.");

    writeText.mockRejectedValueOnce(new Error("denied"));
    await user.click(screen.getByTestId("copy-diagnostics"));
    expect(screen.getByRole("status")).toHaveTextContent("Diagnostics could not be copied");
  });
});
