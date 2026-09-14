import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { m } from "@/i18n";
import { AppShell } from "./AppShell";
import { useStore } from "@/store/useStore";
import { DEFAULT_ACCOUNT_ID, resetStoreWithAccount } from "@/test/fixtures";
import { setOfflineReadState } from "@/data/offlineCache";

vi.mock("@/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n")>()),
  syncLocaleFromAccount: vi.fn(),
}));
vi.mock("@/data/apiConfig", () => ({
  API_BASE: "",
  isDemoMode: () => true,
  isServerConfigured: () => false,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useStore.getState().setFakeSignedIn(true);
  localStorage.setItem("capacitylens/productOrientation/v1/demo/acct-test", "dismissed");
  resetStoreWithAccount();
  useStore.getState().clearFilters();
  useStore.getState().setNotice(null);
  useStore.getState().setMasquerade({ kind: "inactive" });
  useStore.getState().setHydrated(true);
  setOfflineReadState("cleanup", false);
});

const renderAppShell = () =>
  render(
    <MemoryRouter>
      <AppShell />
    </MemoryRouter>,
  );

describe("AppShell offline timestamp banner", () => {
  it("shows the masquerade banner above an offline alert with its local timestamp", () => {
    useStore.getState().setMasquerade({
      kind: "active",
      generation: 1,
      state: {
        accountId: DEFAULT_ACCOUNT_ID,
        targetUserId: "u-viewer",
        targetName: "Selina Kyle",
        effectiveRole: "viewer",
        startedAt: "2026-09-01T10:00:00.000Z",
        token: "token-1",
      },
    });
    setOfflineReadState("tenant", true, Date.parse("2026-09-01T10:00:00.000Z"));
    renderAppShell();

    const banner = screen.getByTestId("masquerade-banner");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent("Masquerading as Selina Kyle");
    expect(within(banner).getByRole("button", { name: "End now" })).toBeInTheDocument();
    expect(
      banner.compareDocumentPosition(screen.getByTestId("offline-read-only")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByTestId("offline-read-only")).toHaveTextContent(
      new Date("2026-09-01T10:00:00.000Z").toLocaleString(),
    );
  });

  it.each([undefined, 0])("uses the unknown-time fallback for %s timestamps", (lastUpdated) => {
    setOfflineReadState("tenant", true, lastUpdated);
    renderAppShell();

    expect(screen.getByTestId("offline-read-only")).toHaveTextContent(m.app_offline_unknown_time());
  });
});
