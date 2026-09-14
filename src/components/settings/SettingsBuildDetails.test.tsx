import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { useStore } from "../../store/useStore";
import { resetStoreWithAccount } from "../../test/fixtures";

vi.mock("../../data/offlineCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../data/offlineCache")>()),
  isOfflineReadEnabled: () => false,
}));

beforeEach(() => {
  resetStoreWithAccount();
  useStore.getState().setTheme("light");
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

afterEach(() => vi.unstubAllEnvs());

describe("SettingsView — build details", () => {
  it("renders no stamp when VITE_CAPACITYLENS_BUILD_SHA is unset but keeps server diagnostics", () => {
    render(<SettingsView />);
    expect(screen.queryByTestId("build-stamp")).not.toBeInTheDocument();
    expect(screen.getByTestId("persistence-diagnostics")).toHaveTextContent("Failed saves: 0");
  });

  it("omits the build details row for an unstamped demo without feedback", () => {
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1");
    vi.stubEnv("VITE_CAPACITYLENS_FEEDBACK_MAILTO", "");
    render(<SettingsView />);
    expect(screen.queryByTestId("settings-build-details")).not.toBeInTheDocument();
  });

  it("renders the named build details row when the build is stamped", () => {
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "a1b2c3d");
    render(<SettingsView />);
    expect(screen.getByTestId("settings-build-details")).toBeVisible();
    expect(screen.getByTestId("build-stamp")).toHaveTextContent("build a1b2c3d · server");
  });

  it("renders no Send feedback link by default, and a stamped mailto when configured", () => {
    const { unmount } = render(<SettingsView />);
    expect(screen.queryByTestId("send-feedback")).not.toBeInTheDocument();
    unmount();

    vi.stubEnv("VITE_CAPACITYLENS_FEEDBACK_MAILTO", "owner@example.com");
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "a1b2c3d");
    render(<SettingsView />);
    const link = screen.getByTestId("send-feedback");
    expect(link).toHaveTextContent("Send feedback");
    expect(link).toHaveAttribute(
      "href",
      `mailto:owner@example.com?subject=${encodeURIComponent("CapacityLens feedback — build a1b2c3d · server")}`,
    );
  });
});
