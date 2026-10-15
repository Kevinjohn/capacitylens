import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiagnosticsView } from "./DiagnosticsView";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        server: {
          connectivity: "ok",
          database: { status: "ok", schemaVersion: 38 },
          persistence: "unknown",
          backup: { status: "unavailable", lastSuccessAt: null },
        },
      }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Diagnostics build details", () => {
  it("omits the section when the build has no stamp or feedback address", () => {
    render(<DiagnosticsView />);
    expect(screen.queryByTestId("settings-build-details")).not.toBeInTheDocument();
    expect(screen.queryByTestId("build-stamp")).not.toBeInTheDocument();
  });

  it("shows the build stamp on Diagnostics", () => {
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "a1b2c3d");
    render(<DiagnosticsView />);
    expect(screen.getByTestId("settings-build-details")).toBeVisible();
    expect(screen.getByTestId("build-stamp")).toHaveTextContent("build a1b2c3d · server");
  });

  it("renders a stamped feedback mailto when configured", () => {
    vi.stubEnv("VITE_CAPACITYLENS_FEEDBACK_MAILTO", "owner@example.com");
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "a1b2c3d");
    render(<DiagnosticsView />);
    const link = screen.getByTestId("send-feedback");
    expect(link).toHaveTextContent("Send feedback");
    expect(link).toHaveAttribute(
      "href",
      `mailto:owner@example.com?subject=${encodeURIComponent("CapacityLens feedback — build a1b2c3d · server")}`,
    );
  });
});
